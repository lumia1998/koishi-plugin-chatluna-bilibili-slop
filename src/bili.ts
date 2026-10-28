import { createHash } from 'node:crypto'
import { h } from 'koishi'
import type { Config } from './config.js'
import type { AuthStore, Credential } from './auth.js'
import { UA } from './auth.js'
import { ApiClient, BiliError } from './http.js'
import type { Comment, InboxItem, Mention, VideoStats } from './types.js'

const API = 'https://api.bilibili.com'
const VC = 'https://api.vc.bilibili.com'
const LOGGER = 'chatluna-bilibili-slop'

/** 首页推荐流的一条（只声明用得到的字段） */
interface RawFeed {
    id?: number, bvid?: string, cid?: number, goto?: string, title?: string
    owner?: { name: string, mid: number }, duration?: number | string, pubdate?: number
    pic?: string, desc?: string, stat?: { view?: number, reply?: number }
}

/** 收藏夹 / 收藏条目 */
interface RawFolder { id?: number, fid?: number, title?: string, media_count?: number, count?: number }
interface RawMedia { bvid?: string, id?: number, type?: number }

/** @ 提醒 / 回复提醒的一条 */
interface RawInbox {
    id?: number | string
    user?: { mid?: number | string, nickname?: string }
    item?: {
        uri?: string, native_uri?: string, source_content?: string, title?: string
        rid?: number | string, rpid?: number | string, target_reply_id?: number | string
    }
    at_time?: number, reply_time?: number, ctime?: number, time?: number
}

interface RawVideo {
    bvid?: string, aid?: number, cid?: number, title?: string, author?: string
    owner?: { name: string, mid: number }, mid?: number
    duration?: number | string, length?: string, pubdate?: number, created?: number
    play?: number, review?: number, comment?: number, video_review?: number
    description?: string, desc?: string, pic?: string
    stat?: { view: number, reply: number }, pages?: { cid: number }[]
}

interface RawComment {
    rpid: number, rpid_str?: string, root?: number, root_str?: string
    parent?: number, parent_str?: string, like: number
    member: { mid: string, uname: string }
    content: { message: string, members?: unknown[] }
}

function toSeconds(value: number | string | undefined): number {
    if (typeof value === 'number') return value
    if (!value) return 0
    return value.split(':').map(Number).reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0)
}

/** 数字兜底：NaN / undefined / 字符串数字都归一成 number */
function num(value: unknown): number {
    const out = Number(value)
    return Number.isFinite(out) ? out : 0
}

/** 弹幕 XML 里的实体解码 */
function decodeXml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
}

/** 从任意链接里抠 BV 号 */
function pickBvid(...candidates: (string | undefined)[]): string | undefined {
    for (const text of candidates) {
        const hit = /BV[0-9A-Za-z]{10}/.exec(String(text || ''))
        if (hit) return hit[0]
    }
    return
}

function normalizeVideo(raw: RawVideo): any {
    return {
        ...raw,
        bvid: raw.bvid || '',
        aid: raw.aid || 0,
        cid: raw.cid || raw.pages?.[0]?.cid || 0,
        title: (raw.title || '').replace(/<[^>]+>/g, ''),
        author: raw.owner?.name || raw.author || '',
        owner: raw.owner || { name: raw.author || '', mid: raw.mid || 0 },
        duration: toSeconds(raw.duration ?? raw.length),
        pubdate: raw.pubdate || raw.created || 0,
        play: raw.stat?.view ?? raw.play ?? 0,
        comments: raw.stat?.reply ?? raw.comment ?? raw.video_review ?? 0,
        description: raw.desc || raw.description || '',
    }
}

/**
 * 原生 B站客户端：替代 @lumia.wang/adapter-bilibili 的 bot.internal 门面。
 * 返回结构保持适配器那套「原始 B站字段」，上层 api.ts 不用改归一化逻辑。
 */
export class NativeBili {
    private readonly names = new Map<string, string>()

    constructor(
        readonly ctx: any,
        readonly auth: AuthStore,
        readonly http: ApiClient,
    ) {}

    get selfId() { return this.auth.selfId }

    /** 写操作统一先确认登录，避免把 -101 当成业务错误 */
    private requireLogin() {
        if (!this.auth.loggedIn) throw new Error('还没有登录 B站：先执行 bili login 扫码')
        if (!this.auth.csrf) throw new Error('登录凭证缺少 bili_jct，请重新扫码登录')
    }

    private logger?: any

    /** 读接口失败只记日志、不往上抛；测试环境没有 ctx 时退化成 console */
    private warn(message: string) {
        try {
            this.logger ??= this.ctx?.logger?.(LOGGER) ?? console
            this.logger.warn(message)
        } catch { /* 日志失败不影响业务 */ }
    }

    private cidOf(info: RawVideo): number {
        const cid = info.cid || info.pages?.[0]?.cid
        if (!cid) throw new Error('视频没有 cid')
        return cid
    }

    // #region 视频

    async getVideoInfo(bvid: string): Promise<any> {
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error(`无效的 BV 号：${bvid}`)
        return this.http.get<RawVideo>('/x/web-interface/view', { params: { bvid } })
    }

    async getVideoSubtitle(bvid: string, item?: RawVideo): Promise<{ text: string }> {
        const info = item || await this.getVideoInfo(bvid)
        const cid = this.cidOf(info)
        const data = await this.http.get<{ subtitle?: { subtitles: { lan: string, subtitle_url: string }[] } }>(
            '/x/player/wbi/v2',
            { params: { aid: info.aid, cid }, sign: true, referer: `https://www.bilibili.com/video/${bvid}` },
        )
        const tracks = data.subtitle?.subtitles || []
        const track = tracks.find((s) => ['ai-zh', 'zh-CN', 'zh'].includes(s.lan)) || tracks[0]
        if (!track) return { text: '' }
        const url = track.subtitle_url.startsWith('//') ? `https:${track.subtitle_url}` : track.subtitle_url
        const body = await this.http.download(url, { maxBytes: 8 * 1024 * 1024 }) as Buffer
        const json = JSON.parse(body.toString('utf8')) as { body?: { content: string }[] }
        return { text: (json.body || []).map((row) => row.content).join('\n') }
    }

    async getVideoConclusion(bvid: string, cid: number, upMid: number): Promise<any | null> {
        const data = await this.http.get<any>('/x/web-interface/view/conclusion/get', {
            params: { bvid, cid, up_mid: upMid },
            sign: true,
            referer: `https://www.bilibili.com/video/${bvid}`,
        })
        return data || null
    }

    async getVideoComments(bvid: string, options: { limit?: number, root?: string, anonymous?: boolean, sort?: 'hot' | 'time' } = {}): Promise<Comment[]> {
        const info = await this.getVideoInfo(bvid)
        const limit = Math.max(1, Math.min(options.limit ?? 30, 60))
        if (options.root && !/^\d+$/.test(options.root)) throw new Error('无效的 root 评论 ID')
        const anon = !!options.anonymous
        const rows: Comment[] = []
        let next = 0

        for (let page = 1; page <= 3 && rows.length < limit; page++) {
            const path = options.root ? '/x/v2/reply/reply' : '/x/v2/reply/main'
            const params = options.root
                ? { type: 1, oid: info.aid, root: options.root, ps: 20, pn: page }
                : { type: 1, oid: info.aid, mode: options.sort === 'time' ? 2 : 3, next, ps: 20 }
            const data = await this.http.get<{ replies: RawComment[] | null, cursor?: { next: number, is_end: boolean } }>(
                path, { params, anon, referer: `https://www.bilibili.com/video/${bvid}` },
            )
            const replies = data.replies || []
            rows.push(...replies.map((raw) => ({
                rpid: raw.rpid_str || String(raw.rpid),
                root: raw.root_str || String(raw.root || 0),
                parent: raw.parent_str || String(raw.parent || 0),
                uid: String(raw.member.mid),
                name: raw.member.uname,
                text: raw.content.message,
                likes: raw.like,
                mentions: !!raw.content.members?.length,
            })))
            if (!replies.length || (!options.root && (!data.cursor || data.cursor.is_end))) break
            next = data.cursor?.next || 0
        }
        return rows.slice(0, limit)
    }

    async getCommentVisibility(bvid: string, rpid: string, root?: string): Promise<'public' | 'pending' | 'missing'> {
        if (!/^\d+$/.test(rpid)) throw new Error('无效的评论 ID')
        const options = { limit: 60, root, sort: 'time' as const }
        if ((await this.getVideoComments(bvid, { ...options, anonymous: true })).some((item) => item.rpid === rpid)) return 'public'
        if ((await this.getVideoComments(bvid, { ...options, anonymous: false })).some((item) => item.rpid === rpid)) return 'pending'
        return 'missing'
    }

    async getRelatedVideos(bvid: string): Promise<any[]> {
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error(`无效的 BV 号：${bvid}`)
        const data = await this.http.get<RawVideo[]>('/x/web-interface/archive/related', { params: { bvid } })
        return (data || []).map(normalizeVideo)
    }

    async getVideoAudio(bvid: string, options: { maxDuration?: number } = {}): Promise<{ data: Buffer }> {
        const maxDuration = options.maxDuration ?? 1800
        const info = await this.getVideoInfo(bvid)
        const cid = this.cidOf(info)
        const duration = toSeconds(info.duration)
        if (!duration) throw new Error('无法获取视频时长')
        if (duration > maxDuration) throw new Error(`视频超过转写时长上限（${maxDuration} 秒）`)
        const player = await this.http.get<{ dash?: { audio?: { id: number, codecid?: number, baseUrl?: string, base_url?: string, bandwidth?: number }[] } }>(
            '/x/player/wbi/playurl',
            { params: { bvid, cid, fnval: 16, fnver: 0, fourk: 0, qn: 16 }, sign: true, referer: `https://www.bilibili.com/video/${bvid}` },
        )
        const tracks = (player.dash?.audio || [])
            .filter((track) => [30216, 30232, 30280].includes(track.id) && (!track.codecid || track.codecid === 0))
            .sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0))
        const track = tracks[0]
        if (!track) throw new Error('该视频没有可用的 AAC 音轨')
        const url = track.baseUrl || track.base_url || ''
        if (!url.startsWith('https://')) throw new Error('音轨地址不是 https')
        const data = await this.http.download(url, { maxBytes: 32 * 1024 * 1024, referer: `https://www.bilibili.com/video/${bvid}` })
        if (!data.length) throw new Error('音轨下载为空')
        return { data }
    }

    // #endregion

    // #region 搜索与用户

    async searchVideos(keyword: string, options: { order?: string, page?: number } = {}): Promise<any[]> {
        const data = await this.http.get<{ result?: any[] }>('/x/web-interface/wbi/search/type', {
            params: {
                search_type: 'video',
                keyword,
                page: options.page || 1,
                order: options.order || 'totalrank',
            },
            sign: true,
            referer: 'https://search.bilibili.com/',
        })
        return data.result || []
    }

    async searchUsers(keyword: string, options: { page?: number } = {}): Promise<any[]> {
        const data = await this.http.get<{ result?: any[] }>('/x/web-interface/wbi/search/type', {
            params: { search_type: 'bili_user', keyword, page: options.page || 1 },
            sign: true,
            referer: 'https://search.bilibili.com/',
        })
        return data.result || []
    }

    async searchUsersByName(name: string, exactMatch = false): Promise<any[]> {
        const users = await this.searchUsers(name, { page: 1 })
        if (!exactMatch) return users
        return users.filter((user) => String(user.uname).toLowerCase() === name.toLowerCase())
    }

    async getUserVideos(uid: string, options: { days?: number } = {}): Promise<any[]> {
        if (!/^\d+$/.test(uid)) throw new Error(`无效的 UID：${uid}`)
        const days = Math.max(1, Math.min(options.days ?? 7, 90))
        const since = Date.now() / 1000 - days * 86400
        const result = new Map<string, any>()
        for (let pn = 1; pn <= 2; pn++) {
            const data = await this.http.get<{ list: { vlist: RawVideo[] } }>('/x/space/wbi/arc/search', {
                params: { mid: uid, pn, ps: 30, order: 'pubdate' },
                sign: true,
                referer: `https://space.bilibili.com/${uid}/video`,
            })
            const rows = (data.list?.vlist || []).map(normalizeVideo)
            for (const row of rows) if (row.pubdate >= since) result.set(row.bvid, { ...row, uid })
            if (rows.length < 30 || rows.some((row) => row.pubdate < since)) break
        }
        return [...result.values()].sort((a, b) => b.pubdate - a.pubdate)
    }

    async getUserInfo(uid: string): Promise<any> {
        const data = await this.http.get<{ card?: { name?: string, face?: string, sign?: string, fans?: number, level_info?: { current_level?: number } } }>(
            '/x/web-interface/card', { params: { mid: uid }, referer: `https://space.bilibili.com/${uid}/` },
        )
        const card = data.card || {}
        return {
            mid: uid,
            name: card.name || '',
            face: card.face || '',
            sign: card.sign || '',
            fans: card.fans || 0,
            level: card.level_info?.current_level || 0,
        }
    }

    async getUserName(uid: string): Promise<string> {
        if (String(uid) === this.selfId) return '我'
        const cached = this.names.get(String(uid))
        if (cached) return cached
        try {
            const info = await this.getUserInfo(String(uid))
            if (info.name) this.names.set(String(uid), info.name)
            return info.name || String(uid)
        } catch {
            return String(uid)
        }
    }

    async followUser(uid: string): Promise<boolean> {
        this.requireLogin()
        await this.http.post('/x/relation/modify', { fid: uid, act: 1, re_src: 11, csrf: this.auth.csrf },
            { referer: `https://space.bilibili.com/${uid}/` })
        return true
    }

    async unfollowUser(uid: string): Promise<boolean> {
        this.requireLogin()
        await this.http.post('/x/relation/modify', { fid: uid, act: 2, re_src: 11, csrf: this.auth.csrf },
            { referer: `https://space.bilibili.com/${uid}/` })
        return true
    }

    async isFollowing(uid: string): Promise<boolean> {
        this.requireLogin()
        try {
            const data = await this.http.get<{ attribute?: number }>('/x/relation', {
                params: { fid: uid }, referer: `https://space.bilibili.com/${uid}/`,
            })
            return data.attribute === 2 || data.attribute === 6
        } catch (err) {
            if (err instanceof BiliError && err.code === -101) throw err
            return false
        }
    }

    // #endregion

    // #region 评论

    private async addReply(aid: number, text: string, root: number, parent: number, mentions: Mention[] = []): Promise<string> {
        this.requireLogin()
        const form: Record<string, string | number> = {
            oid: aid,
            type: 1,
            plat: 1,
            message: text,
            root,
            parent,
            csrf: this.auth.csrf,
        }
        if (mentions.length) {
            const map: Record<string, string> = {}
            for (const mention of mentions) if (mention.id && mention.name) map[mention.name] = mention.id
            form.at_name_to_mid = JSON.stringify(map)
        }
        const data = await this.http.post<{ rpid?: number, rpid_str?: string, reply?: { rpid?: number, rpid_str?: string } }>(
            '/x/v2/reply/add', form, { referer: 'https://www.bilibili.com/' },
        )
        const id = data?.rpid_str || data?.reply?.rpid_str || String(data?.rpid || data?.reply?.rpid || '')
        if (!id) throw new Error('评论已提交但没有返回 rpid，不要自动重发')
        return id
    }

    async createVideoComment(bvid: string, text: string, mentions: Mention[] = []): Promise<string> {
        if (!text.trim()) throw new Error('评论内容为空')
        const info = await this.getVideoInfo(bvid)
        return this.addReply(Number(info.aid), text, 0, 0, mentions)
    }

    /** 回复已有评论；target.root 为空时用 replyTo 当根 */
    async sendComment(_channelId: string, text: string, target: { oid: number, type: number, rpid: number, root: number, parent: number }, mentions: Mention[] = []): Promise<string | null> {
        if (!target?.oid) throw new Error('无法确定评论区的 oid')
        return this.addReply(Number(target.oid), text, Number(target.root || target.rpid), Number(target.rpid), mentions)
    }

    async addVideoToFavorite(bvid: string, folderId: string | number): Promise<void> {
        this.requireLogin()
        const id = String(folderId)
        if (!/^\d+$/.test(id) || /^0+$/.test(id)) throw new Error('无效的收藏夹 ID')
        const info = await this.getVideoInfo(bvid)
        await this.http.post('/x/v3/fav/resource/deal', {
            rid: Number(info.aid), type: 2, add_media_ids: id, del_media_ids: '', csrf: this.auth.csrf,
        }, { referer: `https://www.bilibili.com/video/${bvid}` })
    }

    /** 取消收藏：同一个接口，aid 放 del_media_ids */
    async removeVideoFromFavorite(bvid: string, folderId: string | number): Promise<void> {
        this.requireLogin()
        const id = String(folderId)
        if (!/^\d+$/.test(id) || /^0+$/.test(id)) throw new Error('无效的收藏夹 ID')
        const info = await this.getVideoInfo(bvid)
        await this.http.post('/x/v3/fav/resource/deal', {
            rid: Number(info.aid), type: 2, add_media_ids: '', del_media_ids: id, csrf: this.auth.csrf,
        }, { referer: `https://www.bilibili.com/video/${bvid}` })
    }

    // #endregion

    // #region 私信

    private deviceId(): string {
        const hash = createHash('md5').update(`chatluna-bilibili-slop:${this.selfId}`).digest('hex').toUpperCase()
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
    }

    private async uploadImage(url: string): Promise<{ url: string, width: number, height: number, size: number }> {
        const data = await this.http.download(url, { maxBytes: 10 * 1024 * 1024 })
        const form = new FormData()
        form.append('file_up', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'image.png')
        form.append('biz', 'im')
        form.append('csrf', this.auth.csrf)
        const res = await fetch(`${API}/x/dynamic/feed/draw/upload_bfs`, {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                Referer: 'https://www.bilibili.com/',
                Cookie: Object.entries(this.auth.cookies).map(([key, value]) => `${key}=${value}`).join('; '),
            },
            body: form,
            signal: AbortSignal.timeout(30000),
        })
        const json = await res.json() as { code: number, message?: string, data?: { image_url: string, image_width: number, image_height: number, img_size?: number } }
        if (json.code !== 0 || !json.data?.image_url) throw new Error(`私信图片上传失败：${json.message || json.code}`)
        return {
            url: json.data.image_url,
            width: json.data.image_width,
            height: json.data.image_height,
            size: json.data.img_size || data.length,
        }
    }

    private async sendMsg(uid: string, msgType: 1 | 2, content: string): Promise<string> {
        const devId = this.deviceId()
        const signed = await this.http.sign({
            w_sender_uid: this.selfId,
            w_receiver_id: uid,
            w_dev_id: devId,
        })
        const timestamp = Math.floor(Date.now() / 1000)
        const form = {
            'msg[sender_uid]': this.selfId,
            'msg[receiver_id]': uid,
            'msg[receiver_type]': 1,
            'msg[msg_type]': msgType,
            'msg[msg_status]': 0,
            'msg[content]': content,
            'msg[timestamp]': timestamp,
            'msg[dev_id]': devId,
            'msg[new_face_version]': 1,
            build: 0,
            mobi_app: 'web',
            csrf_token: this.auth.csrf,
            csrf: this.auth.csrf,
        }
        const res = await this.http.request<{ msg_key?: number | string }>('POST', `${VC}/web_im/v1/web_im/send_msg`, {
            params: signed,
            form,
            referer: 'https://message.bilibili.com/',
        })
        if (res.code !== 0) throw new BiliError(res.message || res.msg || `发送私信失败 ${res.code}`, res.code)
        return String(res.data?.msg_key || '')
    }

    async sendPrivateMessage(uid: string, content: h.Fragment): Promise<string[]> {
        this.requireLogin()
        const elements = h.normalize(content)
        let text = ''
        let image: string | undefined
        for (const element of elements) {
            if (typeof element === 'string') { text += element; continue }
            if (element.type === 'text') text += String(element.attrs.content || '')
            else if (element.type === 'image') image = String(element.attrs.url || element.attrs.src || '')
        }
        text = text.trim()

        const ids: string[] = []
        if (image) {
            const uploaded = await this.uploadImage(image)
            const id = await this.sendMsg(uid, 2, JSON.stringify({
                url: uploaded.url, width: uploaded.width, height: uploaded.height, size: uploaded.size,
            }))
            if (id) ids.push(id)
        }
        if (text) {
            const id = await this.sendMsg(uid, 1, JSON.stringify({ content: text }))
            if (id) ids.push(id)
        }
        if (!ids.length) throw new Error('私信没有可发送的内容')
        return ids
    }

    async getMessageList(channelId: string, _next?: string, _direction?: string, limit = 20): Promise<{ data: any[] }> {
        this.requireLogin()
        const talker = String(channelId).split(':')[1]
        if (!/^\d+$/.test(talker || '')) return { data: [] }
        const res = await this.http.request<{ messages?: any[] }>('GET', `${VC}/svr_sync/v1/svr_sync/fetch_session_msgs`, {
            params: {
                talker_id: talker,
                session_type: 1,
                begin_seqno: 0,
                size: Math.max(1, Math.min(limit, 50)),
                build: 0,
                mobi_app: 'web',
            },
            referer: 'https://message.bilibili.com/',
        })
        if (res.code !== 0) throw new BiliError(res.message || `读取私信失败 ${res.code}`, res.code)
        const name = await this.getUserName(talker)
        return {
            data: (res.data?.messages || []).map((msg) => ({
                id: String(msg.msg_key),
                content: this.parseMessage(msg),
                user: {
                    id: String(msg.sender_uid),
                    name: String(msg.sender_uid) === this.selfId ? '我' : name,
                },
                timestamp: Number(msg.timestamp || 0) * 1000,
                channel: { id: `private:${talker}`, type: 'direct' },
            })),
        }
    }

    private parseMessage(msg: { msg_type?: number, content?: string }): string {
        let parsed: any = {}
        try { parsed = JSON.parse(String(msg.content || '{}')) } catch { return String(msg.content || '') }
        switch (msg.msg_type) {
            case 1: return String(parsed.content || '')
            case 2: return `[图片] ${parsed.url || ''}`.trim()
            case 5: return '[消息已撤回]'
            default: return `[不支持的消息类型 ${msg.msg_type}]`
        }
    }

    // #endregion

    // #region 数据读取（全部只读：失败记日志并返回空值，不抛）

    /** 视频统计：先读 view 里的 stat，拿不到再打 archive/stat，最后全 0 */
    async getVideoStats(bvid: string): Promise<VideoStats> {
        const empty: VideoStats = { like: 0, coin: 0, favorite: 0, share: 0, danmaku: 0 }
        const pick = (stat: any): VideoStats => ({
            like: num(stat?.like),
            coin: num(stat?.coin),
            favorite: num(stat?.favorite),
            share: num(stat?.share),
            danmaku: num(stat?.danmaku) || num(stat?.danmu) || num(stat?.reply),
        })

        try {
            const info = await this.getVideoInfo(bvid)
            return pick(info?.stat)
        } catch (err) {
            this.warn(`读取视频统计失败（${bvid}）：${(err as Error).message}`)
        }

        try {
            const stat = await this.http.get<{ like?: number, coin?: number, favorite?: number, share?: number, danmaku?: number }>(
                '/x/web-interface/archive/stat', { params: { bvid } },
            )
            return pick(stat)
        } catch (err) {
            this.warn(`读取视频统计失败（archive/stat，${bvid}）：${(err as Error).message}`)
        }

        // 最差也要能识别出 bvid，退回通用搜索页
        return empty
    }

    /** 弹幕：抓 list.so 的 XML，按时间升序，最多 limit 条 */
    async getVideoDanmaku(bvid: string, options: { limit?: number, cid?: number, aid?: number } = {}): Promise<{ time: number, text: string }[]> {
        const limit = Math.max(1, Math.min(options.limit ?? 50, 500))
        try {
            const cid = options.cid || this.cidOf(await this.getVideoInfo(bvid))
            const body = await this.http.download(`${API}/x/v1/dm/list.so?oid=${cid}`, {
                maxBytes: 4 * 1024 * 1024,
                referer: `https://www.bilibili.com/video/${bvid}`,
            })
            const xml = body.toString('utf8')
            const rows: { time: number, text: string }[] = []
            const pattern = /<d p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g
            let hit: RegExpExecArray | null
            while ((hit = pattern.exec(xml))) {
                const time = Number.parseFloat((hit[1] || '').split(',')[0] || '')
                const text = decodeXml(hit[2] || '').trim()
                if (!text || !Number.isFinite(time)) continue
                rows.push({ time: Math.round(time * 100) / 100, text })
            }
            if (!rows.length) return []
            return rows.sort((a, b) => a.time - b.time).slice(0, limit)
        } catch (err) {
            this.warn(`读取弹幕失败（${bvid}）：${(err as Error).message}`)
            return []
        }
    }

    /** 首页推荐流（WBI，需登录） */
    async getRecommend(ps = 30): Promise<any[]> {
        try {
            const size = Math.max(1, Math.min(Math.round(ps) || 30, 50))
            const data = await this.http.get<{ item?: RawFeed[] }>('/x/web-interface/wbi/index/top/feed/rcmd', {
                params: {
                    ps: size,
                    fresh_idx: 1,
                    fresh_type: 4,
                    feed_version: 'V8',
                    brush: 0,
                    homefeed_reverse_req: 0,
                    web_location: 1430650,
                },
                sign: true,
                referer: 'https://www.bilibili.com/',
            })
            return (data.item || [])
                .filter((raw) => raw?.bvid)
                .map((raw) => normalizeVideo({ ...raw, aid: raw.id } as RawVideo))
        } catch (err) {
            this.warn(`读取首页推荐失败：${(err as Error).message}`)
            return []
        }
    }

    /** 收藏夹列表（自己创建的） */
    async getFavoriteFolders(): Promise<{ id: number, title: string, count: number }[]> {
        this.requireLogin()
        const mid = String(this.selfId || this.auth.selfId || '')
        if (!mid) return []

        try {
            const data = await this.http.get<{ list?: RawFolder[] }>('/x/v3/fav/folder/created/list-all', {
                params: { up_mid: mid, jsonp: 'jsonp' },
                referer: 'https://www.bilibili.com/',
            })
            const rows = (data.list || []).map((folder) => ({
                id: num(folder.id ?? folder.fid),
                title: String(folder.title || ''),
                count: num(folder.media_count ?? folder.count),
            }))
            if (rows.length) return rows.filter((row) => row.id > 0)
        } catch (err) {
            this.warn(`读取收藏夹失败（list-all）：${(err as Error).message}`)
        }

        // 分页兜底
        const rows: { id: number, title: string, count: number }[] = []
        try {
            for (let pn = 1; pn <= 3; pn++) {
                const data = await this.http.get<{ list?: RawFolder[], has_more?: boolean }>('/x/v3/fav/folder/created/list', {
                    params: { up_mid: mid, ps: 20, pn },
                    referer: 'https://www.bilibili.com/',
                })
                const items = data.list || []
                rows.push(...items.map((folder) => ({
                    id: num(folder.id ?? folder.fid),
                    title: String(folder.title || ''),
                    count: num(folder.media_count ?? folder.count),
                })))
                if (!data.has_more || !items.length) break
            }
        } catch (err) {
            this.warn(`读取收藏夹失败（created/list）：${(err as Error).message}`)
        }
        return rows.filter((row) => row.id > 0)
    }

    /** 视频是否已在指定收藏夹里（只翻前 3 页，约 60 条） */
    async isInFavorite(bvid: string, folderId: number): Promise<boolean> {
        try {
            if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return false
            const id = num(folderId)
            if (id <= 0) return false
            for (let pn = 1; pn <= 3; pn++) {
                const data = await this.http.get<{ medias?: RawMedia[] | null, has_more?: boolean }>('/x/v3/fav/resource/list', {
                    params: { media_id: id, pn, ps: 20, keyword: '', order: 'mtime', type: 0, tid: 0, platform: 'web' },
                    referer: `https://www.bilibili.com/medialist/detail/ml${id}`,
                })
                const medias = data.medias || []
                if (medias.some((media) => (media.bvid || '') === bvid)) return true
                if (!data.has_more || !medias.length) break
            }
            return false
        } catch (err) {
            this.warn(`查询收藏夹内容失败（${folderId}/${bvid}）：${(err as Error).message}`)
            return false
        }
    }

    /** 用户统计：粉丝 / 关注 / 投稿数 */
    async getUserStat(uid: string): Promise<{ fans: number, following: number, videos: number }> {
        const out = { fans: 0, following: 0, videos: 0 }
        if (!/^\d+$/.test(String(uid || ''))) return out

        try {
            const relation = await this.http.get<{ follower?: number, following?: number }>('/x/relation/stat', {
                params: { vmid: uid }, referer: `https://space.bilibili.com/${uid}/`,
            })
            out.fans = num(relation?.follower)
            out.following = num(relation?.following)
        } catch (err) {
            this.warn(`读取关注统计失败（${uid}）：${(err as Error).message}`)
        }

        try {
            const data = await this.http.get<{ page?: { count?: number }, list?: { vlist?: RawVideo[] } }>('/x/space/wbi/arc/search', {
                params: { mid: uid, pn: 1, ps: 1, order: 'pubdate' },
                sign: true,
                referer: `https://space.bilibili.com/${uid}/video`,
            })
            out.videos = num(data.page?.count)
            if (!out.videos && data.list?.vlist?.length) out.videos = num(data.list.vlist.length)
        } catch (err) {
            this.warn(`读取投稿数失败（${uid}）：${(err as Error).message}`)
        }

        return out
    }

    /** 收到的 @ 与回复（合并后按时间倒序） */
    async getInbox(options: { limit?: number } = {}): Promise<InboxItem[]> {
        this.requireLogin()
        const limit = Math.max(1, Math.min(Math.round(options.limit ?? 20) || 20, 50))
        const rows: InboxItem[] = []

        const mapRow = (raw: RawInbox, kind: 'at' | 'reply'): InboxItem | undefined => {
            const item = raw.item || {}
            const seconds = num(raw.at_time || raw.reply_time || raw.ctime || raw.time)
            const candidates = [item.source_content, item.title, (item as any).content, (item as any).message]
            const text = candidates.map((value) => String(value ?? '').trim()).find(Boolean) || ''
            const fromUid = String(raw.user?.mid ?? '')
            if (!fromUid && !text) return
            return {
                id: String(raw.id ?? item.rid ?? item.rpid ?? ''),
                kind,
                fromUid,
                fromName: String(raw.user?.nickname || fromUid || ''),
                bvid: pickBvid(item.uri, item.native_uri),
                rpid: String(item.rid ?? item.rpid ?? item.target_reply_id ?? '') || undefined,
                text,
                at: seconds ? seconds * 1000 : 0,
                scope: 'video',
            }
        }

        for (const [path, kind] of [['/x/msgfeed/at', 'at'], ['/x/msgfeed/reply', 'reply']] as const) {
            try {
                const data = await this.http.get<{ items?: RawInbox[] }>(path, {
                    params: { pn: 1, ps: limit },
                    referer: 'https://message.bilibili.com/',
                })
                for (const raw of data.items || []) {
                    const row = mapRow(raw, kind)
                    if (row) rows.push(row)
                }
            } catch (err) {
                this.warn(`读取 ${kind} 提醒失败：${(err as Error).message}`)
            }
        }

        return rows.sort((a, b) => b.at - a.at).slice(0, limit)
    }

    /** 未读私信数 */
    async getUnread(): Promise<number> {
        try {
            const data = await this.http.get<{ unread_count?: number }>('/x/msgfeed/unread', {
                referer: 'https://message.bilibili.com/',
            })
            const count = num(data?.unread_count)
            if (count >= 0) return count
        } catch (err) {
            this.warn(`读取未读私信数失败：${(err as Error).message}`)
        }

        try {
            const res = await this.http.request<{ session_list?: { unread_count?: number }[] }>(
                'GET', `${VC}/session_svr/v1/session_svr/get_sessions`,
                { params: { session_type: 1, group_fold: 1, unfollow_fold: 0, sort_rule: 2, build: 0, mobi_app: 'web' }, referer: 'https://message.bilibili.com/' },
            )
            if (res.code !== 0) return 0
            return (res.data?.session_list || []).filter((row) => num(row.unread_count) > 0).length
        } catch (err) {
            this.warn(`统计未读私信失败：${(err as Error).message}`)
            return 0
        }
    }

    // #endregion
}

/** 插件内部当作 bot 用的门面：只保留 api.ts 需要的那几个方法 */
export interface NativeBot {
    platform: 'bilibili'
    selfId: string
    internal: NativeBili
    getUser(id: string): Promise<{ id: string, name: string }>
    sendPrivateMessage(id: string, content: h.Fragment): Promise<string[]>
    getMessageList(channelId: string, next?: string, direction?: string, limit?: number): Promise<{ data: any[] }>
    session(payload: any): any
}

export function createNativeBot(ctx: any, auth: AuthStore): NativeBot {
    const internal = new NativeBili(ctx, auth, new ApiClient(auth))
    return {
        platform: 'bilibili',
        get selfId() { return auth.selfId },
        internal,
        async getUser(id: string) {
            return { id: String(id), name: await internal.getUserName(String(id)) }
        },
        async sendPrivateMessage(id: string, content: h.Fragment) {
            return internal.sendPrivateMessage(String(id), content)
        },
        async getMessageList(channelId: string, next?: string, direction?: string, limit?: number) {
            return internal.getMessageList(channelId, next, direction, limit)
        },
        /** 只给 ASR 的 audio2text 兜底用；没有真实 Bot，给个结构兼容的鸭子对象 */
        session(payload: any) {
            const message = payload?.message || {}
            return {
                ...payload,
                elements: message.elements || [],
                content: message.content || '',
                quote: undefined,
                bot: { selfId: auth.selfId, platform: 'bilibili' },
            }
        },
    }
}

export type { Credential }
export type { Config }
