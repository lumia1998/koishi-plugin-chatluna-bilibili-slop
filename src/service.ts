import { h } from 'koishi'
import type { Api } from './api.js'
import type { Config } from './config.js'
import { resolveVideo, parseUserInput } from './resolve.js'
import { scout } from './scout.js'
import type { Store } from './store.js'
import type { Publication, Video } from './types.js'

const CONTENT_LIMIT = 12000
const COMMENT_RATE_LIMIT = 10 // top-level comments per hour across all videos
const COMMENT_RATE_WINDOW = 3600_000
const RECHECK_DELAY = 60_000
const SHOWN_TTL = 7 * 86400_000

export interface VideoResult {
    bvid: string; aid: number; title: string; author: string; uid: string
    duration: number; pubdate: number; play: number; comments: number
    description: string; pic?: string; url: string
    content: string; contentSource: 'subtitle' | 'asr' | 'summary' | 'none'
    truncated?: boolean; nextOffset?: number
    summary?: string
    asrError?: string
}

export class Service {
    constructor(readonly cfg: Config, readonly store: Store,
        private readonly recognize?: (api: Api, bvid: string) => Promise<string>,
        private readonly recheck?: (api: Api, record: Publication) => void) {}

    /** Resolves any accepted video reference and returns meta + content slice. */
    async video(api: Api, input: string, offset = 0): Promise<VideoResult> {
        const bvid = await resolveVideo(input)
        const item = await api.info(bvid)
        let text = this.store.state.transcripts[bvid]?.text
        let source: VideoResult['contentSource'] = this.store.state.transcripts[bvid]?.source
        if (!text) {
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
                asrError = (err as Error).message
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

    /** User profile + recent uploads + whether we follow them. */
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
        let following: boolean | undefined
        try { following = await api.isFollowing(resolved.id) } catch { /* leave undefined */ }
        return {
            uid: resolved.id, name: name || resolved.id,
            sign: typeof info.sign === 'string' ? info.sign : undefined,
            fans: typeof info.fans === 'number' ? info.fans : undefined,
            level: typeof info.level === 'number' ? info.level : undefined,
            following, recentVideos: videos.map((v) => ({ bvid: v.bvid, title: v.title, pubdate: v.pubdate, play: v.play, comments: v.comments, url: v.url }))
        }
    }

    /** Follow or unfollow an UP. */
    async follow(api: Api, input: string, action: 'follow' | 'unfollow') {
        const target = parseUserInput(input)
        const resolved = await api.resolve(target.uid || target.name!)
        const ok = await api.follow(resolved.id, action)
        return { uid: resolved.id, name: resolved.name, action, success: ok }
    }

    /**
     * Posts a top-level comment or a reply. Plugin-enforced rules: no @ inside
     * the body, at most one top-level comment per account per video, global
     * rate limit, and result is persisted before returning.
     */
    async comment(api: Api, input: string, text: string, opts: { replyTo?: string; root?: string; atOwner?: boolean }) {
        const bvid = await resolveVideo(input)
        if (/@/.test(text)) throw new Error('评论正文不能包含 @；需要 @ 主人时请使用 atOwner 参数')
        const item = await api.info(bvid)
        const mentions: { id: string; name: string }[] = []
        if (opts.atOwner) {
            if (!/^\d+$/.test(this.cfg.ownerUid)) throw new Error('未配置主人 UID（ownerUid），无法 @ 主人')
            const owner = await api.bot.getUser(this.cfg.ownerUid)
            if (!owner?.name) throw new Error(`无法获取主人 ${this.cfg.ownerUid} 的昵称`)
            mentions.push({ id: this.cfg.ownerUid, name: owner.name })
        }
        const prefix = mentions.map((user) => `@${user.name}`).join(' ')
        const body = prefix ? `${prefix} ${text}` : text
        if (body.length > 150) throw new Error('加上 @ 后评论超过 150 字，请缩短正文')
        return this.store.locked(async () => {
            const ledgerKey = `${api.bot.selfId}:${bvid}`
            const hourAgo = Date.now() - COMMENT_RATE_WINDOW
            const recent = Object.values(this.store.state.comments)
                .filter((record) => record.account === api.bot.selfId && Date.parse(record.at) > hourAgo)
            if (recent.length >= COMMENT_RATE_LIMIT) throw new Error('评论发送超出每小时 10 条的全局限速')
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
                throw new Error(`评论发送结果未知：${(err as Error).message}；插件已记录，不会自动重发`)
            }
            await this.store.save()
            this.recheck?.(api, record)
            return { rpid: record.rpid, bvid, root: record.root, parent: record.parent, text: body }
        })
    }

    /** Reads recent private messages with a UID (default: the owner). */
    async dmRead(api: Api, input?: string, limit = 20) {
        const target = input ? parseUserInput(input) : {}
        let uid = target.uid
        if (!uid) {
            if (target.name) uid = (await api.resolve(target.name)).id
            else if (/^\d+$/.test(this.cfg.ownerUid)) uid = this.cfg.ownerUid
            else throw new Error('未指定收件人且未配置主人 UID（ownerUid）')
        }
        const { data } = await api.messages(uid, limit)
        return data.map((message) => ({
            id: message.id,
            from: message.user?.name || message.user?.id || '未知',
            self: String(message.user?.id) === api.bot.selfId,
            content: message.content, timestamp: message.timestamp
        }))
    }

    /** Sends text and/or an image URL via private message. */
    async dmSend(api: Api, input: string | undefined, text: string | undefined, image: string | undefined) {
        if (!this.cfg.allowDm) throw new Error('私信发送功能未开启（allowDm）')
        const target = input ? parseUserInput(input) : {}
        let uid = target.uid
        if (!uid) {
            if (target.name) uid = (await api.resolve(target.name)).id
            else if (/^\d+$/.test(this.cfg.ownerUid)) uid = this.cfg.ownerUid
            else throw new Error('未指定收件人且未配置主人 UID（ownerUid）')
        }
        const allowed = new Set([this.cfg.ownerUid, ...this.cfg.dmWhitelist])
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

    /** Scores slop candidates; marks returned videos as shown for 7 days. */
    async findSlop(api: Api, opts: { keywords?: string[]; ups?: string[]; limit?: number; includeShown?: boolean }) {
        const result = await scout(api, opts.keywords || this.cfg.keywords, opts.ups || this.cfg.ups)
        const now = Date.now()
        const items = result.items.filter((item) => opts.includeShown || !this.store.state.shown[item.bvid] || now - this.store.state.shown[item.bvid] > SHOWN_TTL)
        const picks = items.slice(0, Math.max(1, Math.min(opts.limit || 10, 20)))
        if (picks.length) {
            await this.store.locked(async () => {
                for (const item of picks) this.store.state.shown[item.bvid] = now
                await this.store.save()
            })
        }
        return {
            candidates: result.candidates, scanned: result.scanned, errors: result.errors,
            items: picks.map((item) => ({
                bvid: item.bvid, title: item.title, author: item.author, uid: item.uid,
                url: item.url, duration: item.duration, pubdate: item.pubdate, play: item.play, comments: item.comments,
                score: item.rank!.score, atRatio: item.rank!.atRatio, pureAtRatio: item.rank!.pureAtRatio,
                feedRatio: item.rank!.feedRatio, fromUp: item.rank!.fromUp, series: item.rank!.series,
                evidence: item.rank!.evidence
            }))
        }
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
                comment: this.cfg.allowComment, dm: this.cfg.allowDm, follow: this.cfg.allowFollow,
                transcribe: this.cfg.transcribe,
                push: !!(this.cfg.channels.length && this.cfg.pushTimes.length),
                watch: !!(this.cfg.channels.length && this.cfg.watchUps.length)
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
                outcomes.push({ bvid: record.bvid, rpid: record.rpid, status: 'error', message: (err as Error).message })
            }
        }
        await this.store.locked(() => this.store.save())
        return outcomes
    }
}

export { RECHECK_DELAY }
