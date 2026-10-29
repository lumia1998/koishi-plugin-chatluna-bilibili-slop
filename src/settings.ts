import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * WebUI 配置模型。
 *
 * ChatLuna 插件原生配置页保持空 Schema —— 这里的所有字段都只经由
 * 控制台（`src/console.ts` + `client/`）读写，落盘为 `<data>/bilibili-slop/settings.json`。
 *
 * 分组顺序 = WebUI「配置页」从上到下的顺序：
 *   账号状态 → 主人 → 偏好设置 → 发布方式 → 互动方式 → 解析方式 → 日报 → 高级
 */
export interface Settings {
    // —— 账号状态 ——
    /** B站机器人 UID；留空表示用当前已登录账号 */
    selfId: string
    /** 主人 UID：评论 @ 的对象、私信默认收件人 */
    ownerUid: string

    // —— 偏好设置 ——
    /** 搜索关键词；留空时赤石模式用内置词表 */
    keywords: string[]
    /** 追踪的目标作者（UID 或精确昵称） */
    targetAuthors: string[]
    /** 只保留这些视频类型分区（tname 精确匹配）；留空表示不限 */
    videoTypes: string[]
    /** 屎视频过滤：命中这些词的视频直接丢弃 */
    blockKeywords: string[]
    /** 最短时长（秒），低于此值丢弃；0 = 不限 */
    minDuration: number
    /** 目标时长上限（秒），超过丢弃；0 = 不限 */
    maxDuration: number

    // —— 发布方式（三项相互独立，可多选）——
    /** 在视频评论区 @ 主人（公开可见） */
    publishComment: boolean
    /** 通过 B站私信推送 */
    publishDm: boolean
    /** 推送到 Koishi 群组 */
    publishGroup: boolean
    /** 群组目标，格式 platform:channelId，如 onebot:123456789 */
    channels: string[]
    /** 私信收件人 UID；留空用 ownerUid */
    dmUid: string

    // —— 互动方式（三条独立开关）——
    /** 在视频下发表一级评论 */
    allowComment: boolean
    /** 回复一级评论（楼层） */
    allowReplyRoot: boolean
    /** 回复二级评论（楼中楼） */
    allowReplySub: boolean
    /** 全局限速：每小时最多发多少条评论（一级 + 回复） */
    commentPerHour: number
    /** 评论里额外 @ 的 UID（与 atOwner 一起生效） */
    mentionUids: string[]
    /** 允许发送私信的 UID 白名单；主人始终允许 */
    dmWhitelist: string[]

    // —— 解析方式 ——
    /** 优先读原字幕；关掉则直接走降级链 */
    preferSubtitle: boolean
    /** 无字幕时调用 Koishi sst 服务转写 */
    transcribe: boolean

    // —— 日报 ——
    /**
     * 写日报用的 ChatLuna 模型全名（`platform/name`）。
     * 留空表示不生成 AI 日报，总结页只显示按记录拼出来的清单。
     */
    summaryModel: string

    // —— 高级（保留原有能力，默认关闭）——
    /** 编造诱饵：允许模型在评论里写视频里不存在的内容 */
    bait: boolean
    /** 自动收藏夹 ID；0 = 不收藏 */
    favFolderId: number
    /** Koishi 权限等级下限 */
    authority: number
    /** 额外放行用户，platform:userId */
    allowedUsers: string[]
    /** 每轮最多搬几条 */
    perRun: number
}

export const DEFAULT_TARGET_AUTHORS = [
    '互联网粪王', '你爱咋想咋想吧', '地球online神人集合', '坤坤是条闲鱼',
    '抽象搬运工258', '番茄青蛙-', 'funnybite', '沈井彬-擒史皇',
]

/** 赤石模式内置召回词表 */
export const DEFAULT_KEYWORDS = ['赤石视频', '赤石', '大份视频', '散装大粪', '互联网散装大粪', '抽象视频']

export function defaultSettings(): Settings {
    return {
        selfId: '',
        ownerUid: '',
        keywords: [],
        targetAuthors: [...DEFAULT_TARGET_AUTHORS],
        videoTypes: [],
        blockKeywords: [],
        minDuration: 45,
        maxDuration: 0,
        publishComment: false,
        publishDm: false,
        publishGroup: true,
        channels: [],
        dmUid: '',
        allowComment: false,
        allowReplyRoot: false,
        allowReplySub: false,
        commentPerHour: 10,
        mentionUids: [],
        dmWhitelist: [],
        preferSubtitle: true,
        transcribe: false,
        summaryModel: '',
        bait: false,
        favFolderId: 0,
        authority: 3,
        allowedUsers: [],
        perRun: 3,
    }
}

/** 只挑已知键、按目标类型归一，防止 WebUI 传进来脏数据把运行时打崩 */
export function normalize(raw: unknown): Settings {
    const base = defaultSettings()
    if (!raw || typeof raw !== 'object') return base
    const input = raw as Record<string, unknown>
    const out = base as unknown as Record<string, unknown>

    for (const key of Object.keys(base) as (keyof Settings)[]) {
        if (!(key in input)) continue
        const fallback = base[key]
        const value = input[key]
        if (Array.isArray(fallback)) {
            if (Array.isArray(value)) {
                out[key] = value
                    .filter((item) => typeof item === 'string')
                    .map((item) => item.trim())
                    .filter(Boolean)
            }
            continue
        }
        if (typeof fallback === 'boolean') {
            if (typeof value === 'boolean') out[key] = value
            else if (value === 'true' || value === 'false') out[key] = value === 'true'
            continue
        }
        if (typeof fallback === 'number') {
            const num = Number(value)
            if (Number.isFinite(num)) out[key] = num
            continue
        }
        if (typeof fallback === 'string') {
            if (typeof value === 'string') out[key] = value.trim()
            else if (typeof value === 'number') out[key] = String(value)
        }
    }

    // 范围钳制
    out.commentPerHour = Math.max(1, Math.min(30, Math.round(Number(out.commentPerHour) || 10)))
    out.perRun = Math.max(1, Math.min(10, Math.round(Number(out.perRun) || 3)))
    out.authority = Math.max(0, Math.min(5, Math.round(Number(out.authority) || 3)))
    out.favFolderId = Math.max(0, Math.round(Number(out.favFolderId) || 0))
    out.minDuration = Math.max(0, Math.round(Number(out.minDuration) || 0))
    out.maxDuration = Math.max(0, Math.round(Number(out.maxDuration) || 0))
    out.selfId = String(out.selfId || '')
    out.ownerUid = String(out.ownerUid || '')
    out.dmUid = String(out.dmUid || '')
    // 模型全名是 `platform/name`；填半截（只有名字）没法加载，直接当没配
    out.summaryModel = /^[^/\s]+\/\S+$/.test(String(out.summaryModel || '')) ? String(out.summaryModel) : ''
    out.channels = (out.channels as string[]).filter((item) => /^[\w.-]+:[\w.-]+$/.test(item))
    return out as unknown as Settings
}

/** settings.json 读写；写用 tmp + rename，避免半截文件把插件打挂 */
export class SettingsStore {
    private current: Settings = defaultSettings()
    private queue: Promise<unknown> = Promise.resolve()

    constructor(readonly dir: string) {}

    get value(): Settings { return this.current }

    private get file() { return join(this.dir, 'settings.json') }

    async init(): Promise<Settings> {
        await mkdir(this.dir, { recursive: true })
        try {
            this.current = normalize(JSON.parse(await readFile(this.file, 'utf8')))
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                // 损坏就退回默认值，不阻塞启动；下次保存会自动覆盖
                this.current = defaultSettings()
            }
        }
        return this.current
    }

    /** 局部更新（浅合并），返回合并后的完整配置 */
    update(patch: Partial<Settings>): Promise<Settings> {
        const job = this.queue.then(async () => {
            this.current = normalize({ ...this.current, ...patch })
            await writeFile(this.file + '.tmp', JSON.stringify(this.current, null, 2), 'utf8')
            await rename(this.file + '.tmp', this.file)
            return this.current
        })
        this.queue = job.catch(() => {})
        return job
    }

    async save(): Promise<void> {
        await this.update({})
    }
}
