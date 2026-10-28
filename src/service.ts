import { h } from 'koishi'
import type { Api } from './api.js'
import type { Config } from './config.js'
import { parseUserInput, resolveVideo } from './resolve.js'
import { rank } from './score.js'
import { scout } from './scout.js'
import type { Store } from './store.js'
import type { InboxItem, Publication, ShuttleRecord, Video, VideoStats } from './types.js'

const CONTENT_LIMIT = 12000
const COMMENT_RATE_LIMIT = 10 // top-level comments per hour across all videos
const COMMENT_RATE_WINDOW = 3600_000
const RECHECK_DELAY = 60_000
const SHOWN_TTL = 7 * 86400_000
const SHUTTLE_LIMIT = 20
const SHUTTLE_CONTENT_LIMIT = 500
const DANMAKU_LIMIT = 30

/** 发布通道；与 `ShuttleRecord.delivery` 同义 */
export type Channel = 'comment' | 'dm' | 'group'

export interface VideoResult {
    bvid: string; aid: number; title: string; author: string; uid: string
    duration: number; pubdate: number; play: number; comments: number
    description: string; pic?: string; url: string
    content: string; contentSource: 'subtitle' | 'asr' | 'summary' | 'none'
    truncated?: boolean; nextOffset?: number
    summary?: string
    asrError?: string
    stats?: VideoStats
    danmaku?: { time: number, text: string }[]
}

export interface ShuttleResult {
    picks: ShuttleRecord[]
    delivered: Channel[]
    errors: string[]
    candidates: number
    scanned: number
}

export interface InboxResult {
    items: InboxItem[]
    replied?: { id: string, ok: boolean, error?: string }[]
}

export interface ShuttleOptions {
    keywords?: string[]
    ups?: string[]
    limit?: number
    /** 模型现场写的搬运理由；必填，插件不会替你编 */
    reason?: string
    /** 指定单条时跳过召回 */
    bvid?: string
    includeShown?: boolean
    /**
     * 发布回调，由调用方接到 publish 层。返回实际成功的通道；
     * 记录已先落库，这里只补 `delivery` 字段。
     */
    deliver?: (records: ShuttleRecord[]) => Promise<Channel[]>
}

export interface InboxOptions {
    action: 'read' | 'reply'
    /** 缺省 read 时合并私信与提醒，reply 时按 dm 处理 */
    kind?: 'dm' | 'comment' | 'thread' | 'at'
    /** 回复对象：私信用 uid/昵称；评论用 rpid */
    target?: string
    /** 评论/楼中楼回复必须给 */
    video?: string
    /** 楼中楼根评论 rpid；缺省时用 target */
    root?: string
    text?: string
    limit?: number
}

/** 打分后的候选；scout 的 rank 只用于搬运排序，不进 ShuttleRecord */
interface Scored {
    item: Video
    score?: number
    atRatio?: number
    evidence?: string[]
}

/** 私信原始消息（`api.messages` 透传适配器数据） */
interface RawMessage {
    id?: string
    content?: string
    timestamp?: number | string
    user?: { id?: string, name?: string }
}

/** 尽力而为：失败就当作没有，不影响主流程 */
async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try { return await fn() } catch { return undefined }
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

/** B站时间戳有秒/毫秒两种，ISO 字符串也见过 */
function timestamp(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value < 1e12 ? value * 1000 : value
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return Date.now()
}

export class Service {
    constructor(readonly cfg: Config, readonly store: Store,
        private readonly recognize?: (api: Api, bvid: string) => Promise<string>,
        private readonly recheck?: (api: Api, record: Publication) => void) {}

    /** Resolves any accepted video reference and returns meta + content slice. */
    async video(api: Api, input: string, offset = 0): Promise<VideoResult> {
        const bvid = await resolveVideo(input)
        const item = await api.info(bvid)
        // 统计数据是锦上添花，拿不到就不带这两个字段
        const [stats, danmaku] = await Promise.all([
            attempt(() => api.stats(item)),
            attempt(() => api.danmaku(item, DANMAKU_LIMIT)),
        ])
        let text = this.store.state.transcripts[bvid]?.text
        let source: VideoResult['contentSource'] = this.store.state.transcripts[bvid]?.source
        if (!text && this.cfg.preferSubtitle) {
            try {
                const subtitle = await api.subtitle(item)
                if (subtitle) {
                    text = subtitle
                    source = 'subtitle'
                    await this.store.locked(async () => {
                        this.store.state.transcripts[bvid] = { text: text!, source: 'subtitle', at: Date.now() }
                        await this.store.save()
                    })
                }
            } catch { /* subtitle failures fall through to ASR/summary */ }
        }
        let asrError: string | undefined
        if (!text && this.cfg.transcribe && this.recognize) {
            try {
                const transcript = await this.recognize(api, bvid)
                if (transcript) {
                    text = transcript
                    source = 'asr'
                    await this.store.locked(async () => {
                        this.store.state.transcripts[bvid] = { text: text!, source: 'asr', at: Date.now() }
                        await this.store.save()
                    })
                }
            } catch (err) {
                // ASR failures degrade to the AI summary path with a note.
                asrError = errorText(err)
            }
        }
        // Always try the official AI summary once; failures are ignored.
        let summaryText: string | undefined
        try {
            const conclusion = await api.summary(item)
            if (conclusion) {
                summaryText = conclusion.outline.length
                    ? conclusion.summary + '\n\n' + conclusion.outline.map((row) =>
                        `${row.title}\n` + row.parts.map((part) => `  ${part.content}`).join('\n')).join('\n')
                    : conclusion.summary
            }
        } catch { /* AI summary is best-effort */ }
        if (!text && summaryText) {
            text = summaryText
            source = 'summary'
        }
        if (!text) source = 'none'
        const full = text || ''
        const slice = full.slice(offset, offset + CONTENT_LIMIT)
        const result: VideoResult = {
            bvid: item.bvid, aid: item.aid, title: item.title, author: item.author, uid: item.uid,
            duration: item.duration, pubdate: item.pubdate, play: item.play, comments: item.comments,
            description: item.description, pic: item.pic, url: item.url,
            content: slice, contentSource: source!
        }
        if (summaryText && source !== 'summary') result.summary = summaryText.slice(0, 4000)
        if (asrError) result.asrError = asrError
        if (stats) result.stats = stats
        if (danmaku?.length) result.danmaku = danmaku
        if (offset + CONTENT_LIMIT < full.length) {
            result.truncated = true
            result.nextOffset = offset + CONTENT_LIMIT
        }
        return result
    }

    /** Hot comments, or replies inside a thread when root is given. */
    async comments(api: Api, input: string, root?: string, limit = 30) {
        const bvid = await resolveVideo(input)
        const item = await api.info(bvid)
        return api.comments(item, limit, root)
    }

    /** Search videos or users. */
    async search(api: Api, keyword: string, type: 'video' | 'user', order?: 'totalrank' | 'pubdate' | 'click' | 'dm' | 'stow' | 'scores' | 'attention', page = 1) {
        if (type === 'user') {
            const users = await api.searchUsers(keyword, page)
            return users.map((user) => ({
                uid: String(user.mid), name: user.uname, sign: user.usign, fans: user.fans,
                videos: user.videos, level: user.level, verify: user.official_verify?.desc || user.verify_info || ''
            }))
        }
        return api.search(keyword, order || 'totalrank', page)
    }

    /**
     * User profile + recent uploads + whether we follow them.
     *
     * `fans` / `following` / `videos` 来自 `api.userStat`（`following` 是关注数，不是布尔）；
     * 我们是否已关注存在 `followed` 里。
     */
    async user(api: Api, input: string, days = 7) {
        const target = parseUserInput(input)
        const resolved = target.uid ? { id: target.uid, name: '' } : await api.resolve(target.name!)
        let name = resolved.name
        let info: Record<string, unknown> = {}
        try {
            const raw = await api.userInfo(resolved.id) as Record<string, unknown>
            info = raw || {}
            if (!name && typeof raw?.name === 'string') name = raw.name
        } catch { /* profile fields stay minimal */ }
        const videos = await api.up(resolved.id, days)
        const followed = await attempt(() => api.isFollowing(resolved.id))
        const stat = await attempt(() => api.userStat(resolved.id))
        return {
            uid: resolved.id, name: name || resolved.id,
            sign: typeof info.sign === 'string' ? info.sign : undefined,
            fans: stat?.fans ?? (typeof info.fans === 'number' ? info.fans : undefined),
            following: stat?.following,
            videos: stat?.videos,
            level: typeof info.level === 'number' ? info.level : undefined,
            followed,
            recentVideos: videos.map((v) => ({ bvid: v.bvid, title: v.title, pubdate: v.pubdate, play: v.play, comments: v.comments, url: v.url }))
        }
    }

    /** Follow or unfollow an UP. */
    async subscribe(api: Api, input: string, action: 'follow' | 'unfollow') {
        const target = parseUserInput(input)
        const name = target.uid || target.name
        if (!name) throw new Error('请提供 UID 或精确昵称')
        const resolved = await api.resolve(name)
        const ok = await api.follow(resolved.id, action)
        return { uid: resolved.id, name: resolved.name, action, success: ok }
    }

    /**
     * 收藏夹操作。`list` 不需要视频；`add` 会先收藏再用 `inFavorite` 复核；
     * `remove` 需要 Api 层提供取消收藏方法，没有就明确返回失败而不是假装成功。
     */
    async manage(api: Api, action: 'list' | 'add' | 'remove', opts: { video?: string, folderId?: number } = {}) {
        if (action === 'list') {
            const folders = await api.favoriteFolders()
            return { ok: true, folders }
        }
        if (!opts.video) throw new Error('需要一个视频（BV 号、av 号或 B站链接）')
        const bvid = await resolveVideo(opts.video)
        const folderId = opts.folderId || this.cfg.favFolderId
        if (!folderId) return { ok: false, bvid, error: '未指定收藏夹（folderId），且未配置默认收藏夹（favFolderId）' }
        const item = await api.info(bvid)
        if (action === 'add') {
            await api.favorite(bvid, folderId)
            const confirmed = await attempt(() => api.inFavorite(item, folderId))
            return { ok: true, bvid, folderId, favorite: confirmed }
        }
        await api.unfavorite(bvid, folderId)
        // 复核一次：true = 确实不在收藏夹了；undefined = 查不到，只当参考
        const stillThere = await attempt(() => api.inFavorite(item, folderId))
        return { ok: true, bvid, folderId, removed: stillThere === undefined ? undefined : !stillThere }
    }

    /**
     * Posts a top-level comment or a reply. Plugin-enforced rules: no @ inside
     * the body, at most one top-level comment per account per video, global
     * rate limit, and result is persisted before returning.
     *
     * 回复的开关（allowReplyRoot / allowReplySub）在这里拦；发表一级评论由调用方
     * 各自按 allowComment / publishComment 判断。
     */
    async comment(api: Api, input: string, text: string, opts: { replyTo?: string; root?: string; atOwner?: boolean }) {
        const bvid = await resolveVideo(input)
        if (opts.replyTo) {
            const root = opts.root || opts.replyTo
            if (root === opts.replyTo) {
                if (!this.cfg.allowReplyRoot) throw new Error('回复一级评论已关闭（allowReplyRoot）')
            } else if (!this.cfg.allowReplySub) {
                throw new Error('回复楼中楼已关闭（allowReplySub）')
            }
        }
        if (/@/.test(text)) throw new Error('评论正文不能包含 @；需要 @ 主人时请使用 atOwner 参数')
        const item = await api.info(bvid)
        const mentions: { id: string; name: string }[] = []
        if (opts.atOwner) {
            const targets = [this.cfg.ownerUid, ...(this.cfg.mentionUids || [])]
                .map((uid) => String(uid || '').trim())
                .filter((uid, index, all) => /^\d+$/.test(uid) && all.indexOf(uid) === index)
            if (!targets.length) throw new Error('未配置主人 UID（ownerUid），无法 @ 主人')
            for (const uid of targets) {
                const user = await api.bot.getUser(uid)
                if (!user?.name) {
                    if (uid === this.cfg.ownerUid) throw new Error(`无法获取主人 ${uid} 的昵称`)
                    continue
                }
                mentions.push({ id: uid, name: user.name })
            }
        }
        const prefix = mentions.map((user) => `@${user.name}`).join(' ')
        const body = prefix ? `${prefix} ${text}` : text
        if (body.length > 150) throw new Error('加上 @ 后评论超过 150 字，请缩短正文')
        return this.store.locked(async () => {
            const ledgerKey = `${api.bot.selfId}:${bvid}`
            const hourAgo = Date.now() - COMMENT_RATE_WINDOW
            const recent = Object.values(this.store.state.comments)
                .filter((record) => record.account === api.bot.selfId && Date.parse(record.at) > hourAgo)
            if (recent.length >= Math.max(1, this.cfg.commentPerHour ?? COMMENT_RATE_LIMIT)) {
                throw new Error(`评论发送超出每小时 ${Math.max(1, this.cfg.commentPerHour ?? COMMENT_RATE_LIMIT)} 条的全局限速`)
            }
            let record: Publication
            if (opts.replyTo) {
                const key = `${ledgerKey}:${opts.replyTo}`
                if (this.store.state.comments[key]) throw new Error('已经回复过此评论，或先前发送结果待确认')
                record = { account: api.bot.selfId, bvid, root: opts.root || opts.replyTo, parent: opts.replyTo, text: body, at: new Date().toISOString(), state: 'sending' }
                this.store.state.comments[key] = record
            } else {
                if (this.store.state.comments[ledgerKey]) throw new Error('本账号已在该视频发表过评论，或上次发送结果待确认')
                record = { account: api.bot.selfId, bvid, text: body, at: new Date().toISOString(), state: 'sending' }
                this.store.state.comments[ledgerKey] = record
            }
            await this.store.save()
            try {
                record.rpid = opts.replyTo
                    ? await api.reply(item, body, opts.replyTo, opts.root || opts.replyTo, mentions)
                    : await api.sendComment(item, body, mentions)
                record.state = 'sent'
            } catch (err) {
                record.state = 'unknown'
                await this.store.save()
                throw new Error(`评论发送结果未知：${errorText(err)}；插件已记录，不会自动重发`)
            }
            await this.store.save()
            this.recheck?.(api, record)
            return { rpid: record.rpid, bvid, root: record.root, parent: record.parent, text: body }
        })
    }

    /** Reads recent private messages with a UID (default: the owner). */
    async dmRead(api: Api, input?: string, limit = 20): Promise<InboxItem[]> {
        return this.dmItems(api, input, limit)
    }

    /** Sends text and/or an image URL via private message. 收件人限主人 + 白名单。 */
    async dmSend(api: Api, input: string | undefined, text: string | undefined, image: string | undefined) {
        const uid = await this.dmUid(api, input)
        const allowed = new Set<string>()
        for (const item of [this.cfg.ownerUid, this.cfg.dmUid, ...this.cfg.dmWhitelist]) {
            const value = String(item || '').trim()
            if (/^\d+$/.test(value)) allowed.add(value)
        }
        if (!allowed.has(uid)) throw new Error(`只允许给主人或白名单 UID 发送私信，${uid} 不在名单内`)
        const body = (text || '').trim()
        if (!body && !image) throw new Error('私信需要文字或图片')
        if (body.length > 470) throw new Error('私信超过 470 字限制')
        const elements = []
        if (body) elements.push(h.text(body))
        if (image) elements.push(h.image(image))
        const ids = await api.dm(uid, elements)
        if (!ids.length) throw new Error('适配器未返回私信 ID，发送结果未知')
        return { uid, messageIds: ids }
    }

    /**
     * 搬视频：召回（或指定单条）→ 偏好过滤 → 7 天去重 → 打分取前 N →
     * 写库（**不发送**）→ 可选交给 `deliver` 发布。
     *
     * `reason` 是模型现场写的理由，必填；插件不替它编。
     */
    async shuttle(api: Api, opts: ShuttleOptions): Promise<ShuttleResult> {
        const reason = (opts.reason || '').trim()
        if (!reason) throw new Error('搬视频需要说明理由（reason）：为什么搬这一条')
        const errors: string[] = []
        const now = Date.now()
        let candidates = 0
        let scanned = 0
        let pool: Scored[] = []

        if (opts.bvid) {
            const bvid = await resolveVideo(opts.bvid)
            const item = await api.info(bvid)
            candidates = 1
            scanned = 1
            let score: number | undefined
            let atRatio: number | undefined
            let evidence: string[] | undefined
            try {
                const ranked = rank(item, await api.comments(item, 30))
                score = ranked.score
                atRatio = ranked.atRatio
                evidence = ranked.evidence
            } catch (err) {
                // 打分只是排序依据，指定单条时缺了不影响搬运
                errors.push(`${bvid}: 打分失败 ${errorText(err)}`)
            }
            pool = [{ item, score, atRatio, evidence }]
        } else {
            const keywords = opts.keywords?.length ? opts.keywords : this.cfg.keywords
            const ups = opts.ups?.length ? opts.ups : this.cfg.targetAuthors
            const result = await scout(api, keywords, ups)
            candidates = result.candidates
            scanned = result.scanned
            errors.push(...result.errors)
            pool = result.items.map((item) => ({
                item,
                score: item.rank?.score,
                atRatio: item.rank?.atRatio,
                evidence: item.rank?.evidence,
            }))
        }

        const filtered = pool.filter(({ item }) => {
            const rejection = this.reject(item)
            if (rejection) {
                // 指定单条时把原因说出来，避免"什么都没搬"却不解释
                if (opts.bvid) errors.push(`${item.bvid}: ${rejection}`)
                return false
            }
            return true
        })
        const usable = filtered.filter(({ item }) => {
            if (opts.includeShown) return true
            const shownAt = this.store.state.shown[item.bvid]
            if (shownAt && now - shownAt <= SHOWN_TTL) {
                if (opts.bvid) errors.push(`${item.bvid}: 最近 7 天已经搬过（需要重搬请加 includeShown）`)
                return false
            }
            return true
        })
        const limit = Math.max(1, Math.min(opts.limit || this.cfg.perRun || 3, SHUTTLE_LIMIT))
        const picks = usable.slice(0, limit)
        const at = new Date(now).toISOString()
        const records: ShuttleRecord[] = picks.map(({ item, score, atRatio, evidence }) => ({
            bvid: item.bvid, title: item.title, author: item.author, uid: item.uid,
            url: item.url, pic: item.pic, duration: item.duration, at, reason,
            content: (item.description || '').slice(0, SHUTTLE_CONTENT_LIMIT),
            play: item.play, comments: item.comments,
            score, atRatio, evidence, delivery: [],
        }))
        if (records.length) {
            await this.store.locked(async () => {
                for (const record of records) {
                    this.store.state.shuttles[record.bvid] = record
                    this.store.state.shown[record.bvid] = now
                }
                await this.store.save()
            })
        }

        let delivered: Channel[] = []
        if (records.length && opts.deliver) {
            try {
                delivered = await opts.deliver(records)
            } catch (err) {
                errors.push(`发布失败：${errorText(err)}`)
            }
            for (const record of records) record.delivery = delivered
            await this.store.locked(() => this.store.save())
        }

        return { picks: records, delivered, errors, candidates, scanned }
    }

    /**
     * 收件箱：读私信 / @ / 回复，或按对象回复。
     *
     * 回复一律走 `comment()` / `dmSend()`，台账、每小时限速、发送结果未知不重发
     * 全部沿用原有实现。
     */
    async inbox(api: Api, opts: InboxOptions): Promise<InboxResult> {
        const limit = Math.max(1, Math.min(opts.limit || 20, 50))
        if (opts.action === 'read') {
            return { items: await this.readInbox(api, opts.kind, limit) }
        }

        const text = (opts.text || '').trim()
        if (!text) throw new Error('回复内容不能为空')
        const kind = opts.kind || 'dm'

        if (kind === 'dm') {
            const result = await this.sendDm(api, opts.target, text)
            return { items: [], replied: [result] }
        }
        if (!opts.video) throw new Error('回复评论需要提供 video（BV 号、av 号或链接）')
        // 开关、白名单、台账、限速的拒绝都作为 ok:false 返回，让模型看得到原因
        const target = kind === 'comment' ? undefined : opts.target
        if (kind === 'thread' && !target) throw new Error('回复楼中楼需要提供 target（要回复的评论 rpid）')
        if (!target && !this.cfg.allowComment) {
            return { items: [], replied: [{ id: opts.video, ok: false, error: '发表一级评论已关闭（allowComment）' }] }
        }
        if (target) {
            const root = opts.root || target
            if (root === target && !this.cfg.allowReplyRoot) {
                return { items: [], replied: [{ id: target, ok: false, error: '回复一级评论已关闭（allowReplyRoot）' }] }
            }
            if (root !== target && !this.cfg.allowReplySub) {
                return { items: [], replied: [{ id: target, ok: false, error: '回复楼中楼已关闭（allowReplySub）' }] }
            }
            return { items: [], replied: [await this.sendComment(api, opts.video, text, { replyTo: target, root })] }
        }
        return { items: [], replied: [await this.sendComment(api, opts.video, text)] }
    }

    /** Account / feature status plus the recent comment ledger. */
    async status(api: Api, verify = false) {
        let verification: unknown
        if (verify) verification = await this.verify(api)
        const comments = Object.values(this.store.state.comments)
            .filter((record) => record.account === api.bot.selfId)
            .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)
        return {
            selfId: api.bot.selfId, ownerUid: this.cfg.ownerUid || undefined,
            features: {
                comment: this.cfg.allowComment,
                replyRoot: this.cfg.allowReplyRoot,
                replySub: this.cfg.allowReplySub,
                dm: this.cfg.publishDm,
                transcribe: this.cfg.transcribe,
                shuttle: !!(this.cfg.publishComment || this.cfg.publishDm || this.cfg.publishGroup),
            },
            verification,
            comments: comments.map((record) => ({
                bvid: record.bvid, root: record.root, rpid: record.rpid, at: record.at,
                state: record.state, visible: record.visible, text: record.text.slice(0, 80)
            }))
        }
    }

    /** Re-checks the public visibility of the most recent sent comments. */
    async verify(api: Api) {
        const records = Object.values(this.store.state.comments)
            .filter((record) => record.account === api.bot.selfId && record.rpid)
            .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
        const outcomes: { bvid: string; rpid?: string; status: string; message?: string }[] = []
        for (const record of records) {
            try {
                record.visible = await api.visible(await api.info(record.bvid), record.rpid!, record.root)
                record.checkedAt = new Date().toISOString()
                outcomes.push({ bvid: record.bvid, rpid: record.rpid, status: record.visible })
            } catch (err) {
                outcomes.push({ bvid: record.bvid, rpid: record.rpid, status: 'error', message: errorText(err) })
            }
        }
        await this.store.locked(() => this.store.save())
        return outcomes
    }

    // —— 内部实现：inbox / dm 共用 ——

    /** 偏好过滤：命中屏蔽词、分区不符、时长越界 → 返回原因 */
    private reject(item: Video): string | undefined {
        const blob = `${item.title}\n${item.description}`
        for (const word of this.cfg.blockKeywords || []) {
            if (word && blob.includes(word)) return `命中屏蔽词「${word}」`
        }
        const types = (this.cfg.videoTypes || []).filter(Boolean)
        if (types.length) {
            // 拿不到 tname（比如推荐流没给分区）时放行，避免误杀
            const tname = item.tname
            if (tname && !types.includes(tname)) return `分区「${tname}」不在允许列表`
        }
        const min = this.cfg.minDuration || 0
        const max = this.cfg.maxDuration || 0
        if (min > 0 && item.duration > 0 && item.duration < min) return `时长 ${item.duration}s 低于 ${min}s`
        if (max > 0 && item.duration > max) return `时长 ${item.duration}s 超过 ${max}s`
        return undefined
    }

    /** 收件人：显式 input > 配置的 dmUid > 主人 */
    private async dmUid(api: Api, input?: string): Promise<string> {
        const target = parseUserInput(input || '')
        if (target.uid) return target.uid
        if (target.name) return (await api.resolve(target.name)).id
        const fallback = (this.cfg.dmUid || this.cfg.ownerUid || '').trim()
        if (/^\d+$/.test(fallback)) return fallback
        throw new Error('未指定收件人且未配置主人 UID（ownerUid）')
    }

    private async dmItems(api: Api, input: string | undefined, limit: number): Promise<InboxItem[]> {
        const uid = await this.dmUid(api, input)
        const { data } = await api.messages(uid, limit)
        const rows = (data || []) as RawMessage[]
        return rows.map((message) => ({
            id: String(message.id || ''),
            kind: 'dm' as const,
            fromUid: String(message.user?.id || ''),
            fromName: message.user?.name || String(message.user?.id || '未知'),
            text: String(message.content || ''),
            at: timestamp(message.timestamp),
            scope: 'dm' as const,
        }))
    }

    private async readInbox(api: Api, kind: InboxOptions['kind'], limit: number): Promise<InboxItem[]> {
        if (kind === 'dm') return this.dmItems(api, undefined, limit)
        if (kind) {
            const items = await api.inbox(limit)
            return items.filter((item) => {
                if (kind === 'at') return item.kind === 'at'
                if (kind === 'thread') return item.kind === 'reply' && item.scope === 'thread'
                return item.kind === 'reply' && item.scope !== 'thread'
            }).slice(0, limit)
        }
        const [dm, box] = await Promise.all([
            attempt(() => this.dmItems(api, undefined, limit)),
            attempt(() => api.inbox(limit)),
        ])
        if (!dm && !box) throw new Error('读取收件箱失败，请检查登录状态')
        return [...(dm || []), ...(box || [])]
            .sort((a, b) => b.at - a.at)
            .slice(0, limit)
    }

    private async sendDm(api: Api, target: string | undefined, text: string) {
        try {
            const result = await this.dmSend(api, target, text, undefined)
            return { id: result.uid, ok: true }
        } catch (err) {
            return { id: target || this.cfg.dmUid || this.cfg.ownerUid || 'dm', ok: false, error: errorText(err) }
        }
    }

    private async sendComment(api: Api, video: string, text: string, opts: { replyTo?: string, root?: string } = {}) {
        const id = opts.replyTo || video
        try {
            const result = await this.comment(api, video, text, opts)
            return { id, ok: true, rpid: result.rpid }
        } catch (err) {
            return { id, ok: false, error: errorText(err) }
        }
    }
}

export { RECHECK_DELAY }
