import { createHash } from 'node:crypto'
import { AuthStore, pickCookies, refreshCredential, UA } from './auth.js'

const WBI_TABLE = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

export interface ApiResponse<T> {
    code: number
    message?: string
    msg?: string
    ttl?: number
    data: T
}

export class BiliError extends Error {
    constructor(message: string, readonly code: number) {
        super(message)
        this.name = 'BiliError'
    }
}

export interface RequestOptions {
    params?: Record<string, string | number | undefined>
    form?: Record<string, string | number | undefined>
    /** 需要 WBI 签名 */
    sign?: boolean
    /** 不带 Cookie 的匿名请求 */
    anon?: boolean
    referer?: string
    /** -101 时是否尝试刷新后重试 */
    retry?: boolean
}

function cookieHeader(cookies: Record<string, string>) {
    return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')
}

function mixinKey(orig: string) {
    let out = ''
    for (const index of WBI_TABLE) out += orig[index]
    return out.slice(0, 32)
}

function clean(value: string) {
    return value.replace(/[!'()*]/g, '')
}

/** B站 API 客户端：Cookie、WBI 签名、-101 自动刷新都在这一层 */
export class ApiClient {
    private wbi?: { img: string, sub: string, at: number }
    private refreshing?: Promise<boolean>

    constructor(
        readonly auth: AuthStore,
        private readonly log: (message: string) => void = () => {},
    ) {}

    get loggedIn() { return this.auth.loggedIn }
    get selfId() { return this.auth.selfId }

    /** 刷新凭证（单飞）；返回是否真的换了 cookie */
    refresh(): Promise<boolean> {
        this.refreshing ??= refreshCredential(this.auth)
            .catch((err) => {
                this.log(`刷新 Cookie 失败：${(err as Error).message}`)
                return false
            })
            .finally(() => { this.refreshing = undefined })
        return this.refreshing
    }

    private async getWbiKeys() {
        const midnight = new Date()
        midnight.setHours(0, 0, 0, 0)
        if (this.wbi && this.wbi.at >= midnight.getTime()) return this.wbi

        const res = await this.request<{ wbi_img?: { img_url: string, sub_url: string } }>(
            'GET', 'https://api.bilibili.com/x/web-interface/nav', { anon: true, retry: false },
        )
        const img = res.data?.wbi_img?.img_url
        const sub = res.data?.wbi_img?.sub_url
        if (!img || !sub) throw new Error('无法获取 WBI 密钥')
        const pick = (url: string) => url.slice(url.lastIndexOf('/') + 1, url.lastIndexOf('.'))
        this.wbi = { img: pick(img), sub: pick(sub), at: Date.now() }
        return this.wbi
    }

    /** 给参数加 wts + w_rid */
    async sign(params: Record<string, string | number | undefined>) {
        const { img, sub } = await this.getWbiKeys()
        const wts = Math.round(Date.now() / 1000)
        const mixed = mixinKey(img + sub)
        const all: Record<string, string | number> = {}
        for (const [key, value] of Object.entries({ ...params, wts })) {
            if (value !== undefined) all[key] = value
        }
        const query = Object.keys(all).sort()
            .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(clean(String(all[key])))}`)
            .join('&')
        return { ...all, w_rid: createHash('md5').update(query + mixed).digest('hex') }
    }

    async request<T>(method: 'GET' | 'POST', url: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
        const { params = {}, form, sign, anon, referer, retry = true } = options
        const query = sign ? await this.sign(params) : params
        const target = new URL(url)
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) target.searchParams.set(key, String(value))
        }

        const headers: Record<string, string> = {
            'User-Agent': UA,
            Referer: referer || 'https://www.bilibili.com/',
            Origin: 'https://www.bilibili.com',
        }
        if (!anon && this.auth.loggedIn) headers.Cookie = cookieHeader(this.auth.cookies)

        let body: string | undefined
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            body = new URLSearchParams(
                Object.entries(form || {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]),
            ).toString()
        }

        const res = await fetch(target, { method, headers, body, signal: AbortSignal.timeout(15000) })
        const setCookies = pickCookies(res.headers)
        if (!anon && Object.keys(setCookies).length) await this.auth.merge(setCookies)

        const text = await res.text()
        let json: ApiResponse<T>
        try {
            json = JSON.parse(text) as ApiResponse<T>
        } catch {
            throw new BiliError(`B站返回了非 JSON（HTTP ${res.status}）`, res.status)
        }

        if (json.code === -101 && !anon && retry) {
            this.log('登录态失效（-101），尝试刷新 Cookie')
            const refreshed = await this.refresh()
            if (refreshed) return this.request<T>(method, url, { ...options, retry: false })
            throw new BiliError('B站登录已失效，请重新扫码登录（bili login）', -101)
        }

        return json
    }

    /** 只要 data，非 0 直接抛 */
    async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
        const json = await this.request<T>('GET', `https://api.bilibili.com${path}`, options)
        if (json.code !== 0) throw new BiliError(json.message || json.msg || `B站接口错误 ${json.code}`, json.code)
        return json.data
    }

    async post<T>(path: string, form: Record<string, string | number | undefined>, options: RequestOptions = {}): Promise<T> {
        const json = await this.request<T>('POST', `https://api.bilibili.com${path}`, { ...options, form })
        if (json.code !== 0) throw new BiliError(json.message || json.msg || `B站接口错误 ${json.code}`, json.code)
        return json.data
    }

    /** 下载二进制（字幕、音频、图片），带大小上限 */
    async download(url: string, options: { maxBytes?: number, referer?: string } = {}): Promise<Buffer> {
        const maxBytes = options.maxBytes ?? 32 * 1024 * 1024
        const res = await fetch(url, {
            headers: {
                'User-Agent': UA,
                Referer: options.referer || 'https://www.bilibili.com/',
            },
            signal: AbortSignal.timeout(60000),
        })
        if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
        const length = Number(res.headers.get('content-length') || 0)
        if (length && length > maxBytes) throw new Error(`文件超过大小限制（${maxBytes} 字节）`)
        const array = new Uint8Array(await res.arrayBuffer())
        if (array.byteLength > maxBytes) throw new Error(`文件超过大小限制（${maxBytes} 字节）`)
        return Buffer.from(array)
    }
}
