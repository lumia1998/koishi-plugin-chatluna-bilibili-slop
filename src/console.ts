import type { Context, Session } from 'koishi'
import type {} from '@koishijs/plugin-console'
import { pollQrLogin, startQrLogin, type AuthStore, type LoginState } from './auth.js'
import type { ReportModel } from './report.js'
import type { Settings, SettingsStore } from './settings.js'
import type { Store } from './store.js'
import { dailyReport, reportIndex, wall } from './summary.js'
import type { ShuttleRecord, ViewRecord } from './types.js'

/**
 * 控制台「刷B站」面板的状态快照。
 *
 * 字段与 `docs/contract-1.0.md` 第 7 节一致；`src/index.ts` 负责拼装，
 * 这里只做转发（`deps.status`）。
 */
export interface ConsoleStatus {
    loggedIn: boolean
    selfId: string
    nickname?: string
    /** ISO 串或毫秒时间戳都接受：`index.ts` 直接给的是 `credential.refreshedAt` */
    refreshedAt?: string | number
    ownerUid: string
    features: {
        comment: boolean
        replyRoot: boolean
        replySub: boolean
        dm: boolean
        transcribe: boolean
        shuttle: boolean
    }
    ledger: { bvid: string, text: string, at: string, state: string, visible?: string }[]
    lastRun?: { at: string, picks: number, errors: string[] }
}

/** 面板里所有 RPC 的统一权限下限：和 Settings.authority 的默认值一致 */
const AUTHORITY = 3

/** 服务端不信任前端传的日期串，只认 YYYY-MM-DD */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const dayFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Asia/Shanghai 的今天；日报与历史都按这个时区切日 */
function today(): string {
    return dayFormat.format(new Date())
}

function normalizeDay(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!DAY_PATTERN.test(text)) return today()
    const time = Date.parse(`${text}T00:00:00+08:00`)
    return Number.isFinite(time) ? text : today()
}

/**
 * 客户端「刷B站」页面用到的全部 RPC。
 *
 * 事件名统一 `bili-slop/` 前缀；客户端通过 `send(type, ...args)` 发起，
 * 服务端 `Console.addListener` 按同名键分发。
 */
declare module '@koishijs/console' {
    interface Events {
        'bili-slop/settings'(): Promise<Settings>
        'bili-slop/settings/update'(patch: Partial<Settings>): Promise<Settings>
        'bili-slop/status'(): Promise<ConsoleStatus>
        'bili-slop/login/start'(): Promise<{ key: string, url: string }>
        'bili-slop/login/poll'(input: { key?: string }): Promise<{ state: LoginState, message?: string }>
        'bili-slop/shuttle'(): Promise<{ ok: boolean }>
        'bili-slop/verify'(): Promise<unknown>
        'bili-slop/summary'(input?: { day?: string }): Promise<{ report: string, wall: ShuttleRecord[] }>
        'bili-slop/reports'(input?: { days?: number }): Promise<{ day: string, count: number }[]>
        'bili-slop/models'(): Promise<{ models: ReportModel[], selected: string }>
        'bili-slop/summary/generate'(input?: { day?: string }): Promise<{ report: string, model: string }>
        'bili-slop/history'(): Promise<ShuttleRecord[]>
        'bili-slop/views'(): Promise<ViewRecord[]>
    }
}

export interface ConsoleDeps {
    settings: SettingsStore
    store: Store
    auth: AuthStore
    /** 聊天里那条登录指令用的实现；控制台扫码走自己的 startQrLogin，这里只为对齐契约保留 */
    login: (session?: Session) => Promise<string>
    status: () => Promise<ConsoleStatus>
    shuttleNow: () => Promise<unknown>
    verify: () => Promise<unknown>
    /** 可选的日报模型（`platform/name`），来自 ChatLuna */
    models: () => ReportModel[]
    /** 用 settings.summaryModel 调模型写某天的日报 */
    report: (day: string) => Promise<string>
}

/**
 * 把控制台 RPC 挂到 `ctx.console` 上。
 *
 * 必须在 `ctx.inject(['console'], ...)` 的上下文里调用：没有控制台服务时
 * `ctx.console` 是 undefined，`addListener` 会直接抛错。
 */
export function mountConsole(ctx: Context, deps: ConsoleDeps): void {
    const console = ctx.console
    if (!console) return

    const { settings, store, auth } = deps

    console.addListener('bili-slop/settings', async () => settings.value, { authority: AUTHORITY })

    console.addListener('bili-slop/settings/update', (patch) => {
        // normalize 会丢掉未知键、钳制数值范围，脏数据进不来
        return settings.update(patch || {})
    }, { authority: AUTHORITY })

    console.addListener('bili-slop/status', () => deps.status(), { authority: AUTHORITY })

    console.addListener('bili-slop/login/start', async () => {
        const ticket = await startQrLogin()
        // 二维码图片由前端用 qrcode 画，服务端只给 url，省一次 base64 往返
        return { key: ticket.key, url: ticket.url }
    }, { authority: AUTHORITY })

    console.addListener('bili-slop/login/poll', async (input) => {
        const key = String(input?.key || '').trim()
        if (!key) return { state: 'unknown' as LoginState, message: '缺少二维码 key，请重新获取二维码' }

        const poll = await pollQrLogin(key)
        if (poll.state !== 'ok' || !poll.credential) {
            return { state: poll.state, message: poll.message }
        }

        // 凭证只留在服务端；前端只需要知道「成了」，之后自己拉 status
        await auth.save(poll.credential)
        return { state: 'ok' as LoginState }
    }, { authority: AUTHORITY })

    console.addListener('bili-slop/shuttle', async () => {
        await deps.shuttleNow()
        return { ok: true }
    }, { authority: AUTHORITY })

    console.addListener('bili-slop/verify', () => deps.verify(), { authority: AUTHORITY })

    console.addListener('bili-slop/summary', async (input) => {
        const day = normalizeDay(input?.day)
        // dailyReport 给 Markdown 正文，wall 摊平成按天分组的记录列表
        return {
            report: dailyReport(store, day),
            wall: wall(store, day).flatMap((group) => group.items),
        }
    }, { authority: AUTHORITY })

    console.addListener('bili-slop/reports', async (input) => {
        const days = Number(input?.days)
        return reportIndex(store, Number.isFinite(days) && days > 0 ? days : undefined)
    }, { authority: AUTHORITY })

    // 配置页的模型下拉：列表来自 ChatLuna，selected 是当前已选
    console.addListener('bili-slop/models', async () => ({
        models: deps.models(),
        selected: settings.value.summaryModel,
    }), { authority: AUTHORITY })

    // 搬运历史页：全量搬运记录，最新在前
    console.addListener('bili-slop/history', async () =>
        Object.values(store.state.shuttles).sort((a, b) => b.at.localeCompare(a.at)),
    { authority: AUTHORITY })

    // 观看历史页：`bili_video` 每次成功解析都会记一条
    console.addListener('bili-slop/views', async () =>
        Object.values(store.state.views).sort((a, b) => b.at.localeCompare(a.at)),
    { authority: AUTHORITY })

    // 总结页的「AI 写日报」：慢（一次模型调用），前端按钮要自己处理 loading
    console.addListener('bili-slop/summary/generate', async (input) => {
        const day = normalizeDay(input?.day)
        const model = settings.value.summaryModel
        const report = await deps.report(day)
        return { report, model }
    }, { authority: AUTHORITY })
}
