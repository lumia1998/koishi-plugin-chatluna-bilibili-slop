import { constants, publicEncrypt } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 统一的 UA：扫码、WBI、评论、私信都用它，减少风控差异 */
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const PASSPORT = 'https://passport.bilibili.com'
const SPI = 'https://api.bilibili.com/x/frontend/finger/spi'
const CORRESPOND = 'https://www.bilibili.com/correspond/1/'

/** refresh_csrf 用的固定公钥（B站 web 端 wasm 里那对） */
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg
Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71
nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40
JNrRuoEUXpabUzGB8QIDAQAB
-----END PUBLIC KEY-----`

const SHORT_COOKIES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid', 'buvid3', 'buvid4', 'b_nut']

export interface Credential {
    version: 1
    mid: string
    cookies: Record<string, string>
    /** 等价于浏览器 localStorage 里的 ac_time_value */
    refreshToken: string
    obtainedAt: number
    refreshedAt?: number
}

export interface LoginTicket { key: string, url: string }

export type LoginState = 'waiting' | 'scanned' | 'expired' | 'ok' | 'unknown'

export interface LoginPoll {
    state: LoginState
    message?: string
    credential?: Credential
}

function timeout(ms: number) {
    return AbortSignal.timeout(ms)
}

/** 从响应头里挑出登录相关的 cookie（Node 20+ 有 getSetCookie） */
export function pickCookies(headers: Headers): Record<string, string> {
    const list = typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : []
    const jar: Record<string, string> = {}
    for (const raw of list) {
        const first = String(raw).split(';')[0] || ''
        const index = first.indexOf('=')
        if (index <= 0) continue
        const name = first.slice(0, index).trim()
        if (!SHORT_COOKIES.includes(name)) continue
        jar[name] = first.slice(index + 1).trim()
    }
    return jar
}

function cookieHeader(cookies: Record<string, string>): string {
    return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')
}

export function correspondPath(timestamp = Date.now()): string {
    return publicEncrypt(
        { key: PUBLIC_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(`refresh_${timestamp}`),
    ).toString('hex')
}

/** 没有 buvid3 时补一张指纹，失败不致命 */
async function ensureBuvid3(cookies: Record<string, string>) {
    if (cookies.buvid3) return
    try {
        const res = await fetch(SPI, { headers: { 'User-Agent': UA }, signal: timeout(8000) })
        const json = await res.json() as { data?: { b_3?: string, b_4?: string } }
        if (json.data?.b_3) cookies.buvid3 = json.data.b_3
        if (json.data?.b_4) cookies.buvid4 = json.data.b_4
    } catch { /* 拿不到就算了，后续请求还能跑 */ }
}

/** 申请二维码 */
export async function startQrLogin(): Promise<LoginTicket> {
    const res = await fetch(`${PASSPORT}/x/passport-login/web/qrcode/generate?source=main-fe-header`, {
        headers: { 'User-Agent': UA },
        signal: timeout(10000),
    })
    const json = await res.json() as { code?: number, message?: string, data?: { url?: string, qrcode_key?: string } }
    if (json.code !== 0 || !json.data?.qrcode_key || !json.data.url) {
        throw new Error(`获取二维码失败：${json.message || json.code || '未知错误'}`)
    }
    return { key: json.data.qrcode_key, url: json.data.url }
}

/** 轮询扫码状态；成功时返回完整凭证（含 refresh_token） */
export async function pollQrLogin(key: string): Promise<LoginPoll> {
    const res = await fetch(`${PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header`, {
        headers: { 'User-Agent': UA },
        redirect: 'manual',
        signal: timeout(10000),
    })
    const jar = pickCookies(res.headers)
    let json: { data?: { code?: number, message?: string, refresh_token?: string } } = {}
    try { json = await res.json() } catch { /* 轮询偶尔空体 */ }

    const code = json.data?.code
    if (code === 0) {
        await ensureBuvid3(jar)
        if (!jar.SESSDATA || !jar.DedeUserID) {
            return { state: 'unknown', message: '登录成功了，但响应里没有 SESSDATA' }
        }
        return {
            state: 'ok',
            credential: {
                version: 1,
                mid: jar.DedeUserID,
                cookies: jar,
                refreshToken: json.data?.refresh_token || '',
                obtainedAt: Date.now(),
            },
        }
    }
    if (code === 86101) return { state: 'waiting' }
    if (code === 86090) return { state: 'scanned' }
    if (code === 86038) return { state: 'expired' }
    return { state: 'unknown', message: json.data?.message || `未知状态 ${code}` }
}

/** 凭证存储：data 目录下的 credential.json（0600） */
export class AuthStore {
    credential?: Credential
    private pending?: ReturnType<typeof setTimeout>
    private writing: Promise<void> = Promise.resolve()

    constructor(readonly dir: string) {}

    get file() { return join(this.dir, 'credential.json') }

    async load() {
        try {
            const raw = JSON.parse(await readFile(this.file, 'utf8')) as Credential
            if (!raw?.cookies?.SESSDATA || !raw.mid) return
            this.credential = raw
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
    }

    get loggedIn() { return !!this.credential?.cookies.SESSDATA }
    get selfId() { return this.credential?.mid || '' }
    get csrf() { return this.credential?.cookies.bili_jct || '' }
    get cookies(): Record<string, string> { return this.credential?.cookies || {} }

    async save(credential: Credential) {
        this.credential = credential
        await this.persist()
    }

    /** 服务端随时可能下发新 cookie（SESSDATA 轮换等），合并后落盘 */
    async merge(cookies: Record<string, string>) {
        if (!this.credential || !Object.keys(cookies).length) return
        let changed = false
        for (const [key, value] of Object.entries(cookies)) {
            if (this.credential.cookies[key] !== value) {
                this.credential.cookies[key] = value
                changed = true
            }
        }
        if (changed) this.schedule()
    }

    async clear() {
        this.credential = undefined
        await rm(this.file, { force: true })
    }

    private schedule() {
        if (this.pending) return
        this.pending = setTimeout(() => {
            this.pending = undefined
            this.persist().catch(() => { /* 下次合并再试 */ })
        }, 500)
        this.pending.unref?.()
    }

    private persist(): Promise<void> {
        const credential = this.credential
        if (!credential) return Promise.resolve()
        this.writing = this.writing.then(async () => {
            await mkdir(dirname(this.file), { recursive: true })
            const tmp = `${this.file}.tmp`
            await writeFile(tmp, JSON.stringify(credential, null, 2), { encoding: 'utf8', mode: 0o600 })
            await rename(tmp, this.file)
            await chmod(this.file, 0o600).catch(() => { /* Windows 上可能不支持 */ })
        })
        return this.writing
    }
}

async function getJson(url: string, cookies: Record<string, string>, referer = 'https://www.bilibili.com/') {
    const res = await fetch(url, {
        headers: {
            'User-Agent': UA,
            Referer: referer,
            Cookie: cookieHeader(cookies),
        },
        signal: timeout(10000),
    })
    return await res.json() as Record<string, any>
}

async function postForm(url: string, fields: Record<string, string>, cookies: Record<string, string>) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'User-Agent': UA,
            Referer: 'https://www.bilibili.com/',
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookieHeader(cookies),
        },
        body: new URLSearchParams(fields).toString(),
        signal: timeout(10000),
    })
    let json: Record<string, any> = {}
    try { json = await res.json() as Record<string, any> } catch { /* confirm 偶尔空体 */ }
    return { json, cookies: pickCookies(res.headers) }
}

/** Cookie 是否还有效（顺带触发一次 -101 检测） */
export async function checkLogin(store: AuthStore): Promise<boolean> {
    if (!store.loggedIn) return false
    try {
        const json = await getJson('https://api.bilibili.com/x/web-interface/nav', store.cookies)
        return json.code === 0 && !!json.data?.isLogin
    } catch {
        return false
    }
}

/**
 * 官方 Cookie 刷新链路：
 *   cookie/info → correspondPath → correspond/1/{path} 取 refresh_csrf
 *   → cookie/refresh（新 cookie + 新 refresh_token）→ 先落盘 → confirm/refresh（作废旧 token）
 */
export async function refreshCredential(store: AuthStore): Promise<boolean> {
    const current = store.credential
    if (!current?.refreshToken || !current.cookies.bili_jct) return false

    const info = await getJson(
        `https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=${encodeURIComponent(current.cookies.bili_jct)}`,
        current.cookies,
        'https://passport.bilibili.com/',
    )
    if (info.code !== 0 || info.data?.refresh !== true) return false

    const html = await fetch(CORRESPOND + correspondPath(), {
        headers: {
            'User-Agent': UA,
            Referer: 'https://www.bilibili.com/',
            Cookie: cookieHeader(current.cookies),
        },
        signal: timeout(10000),
    }).then((res) => res.text())

    const refreshCsrf = /<div id="1-name">([^<]+)<\/div>/.exec(html)?.[1]
    if (!refreshCsrf) throw new Error('refresh_csrf 解析失败（correspond 页面结构可能变了）')

    const oldToken = current.refreshToken
    const refreshed = await postForm('https://passport.bilibili.com/x/passport-login/web/cookie/refresh', {
        csrf: current.cookies.bili_jct,
        refresh_csrf: refreshCsrf,
        source: 'main_web',
        refresh_token: oldToken,
    }, current.cookies)

    if (refreshed.json.code !== 0) {
        throw new Error(`刷新 Cookie 失败：${refreshed.json.message || refreshed.json.code}`)
    }

    const next: Credential = {
        ...current,
        cookies: { ...current.cookies, ...refreshed.cookies },
        refreshToken: refreshed.json.data?.refresh_token || oldToken,
        refreshedAt: Date.now(),
    }
    // 先落盘：confirm 失败也不至于把新凭证丢掉
    await store.save(next)

    try {
        await postForm('https://passport.bilibili.com/x/passport-login/web/confirm/refresh', {
            csrf: next.cookies.bili_jct,
            refresh_token: oldToken,
        }, next.cookies)
    } catch { /* 作废旧 token 失败不影响新凭证使用 */ }

    return true
}
