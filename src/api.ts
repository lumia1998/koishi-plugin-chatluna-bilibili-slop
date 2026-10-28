import { h } from 'koishi'
import type { NativeBili } from './bili.js'
import type { Config } from './config.js'
import { duration } from './score.js'
import type { BiliBot, Comment, InboxItem, Video, VideoStats } from './types.js'

interface RawVideo {
    bvid?: string; aid?: number; cid?: number; title?: string; author?: string
    mid?: number; owner?: { name: string; mid: number }; duration?: string | number
    length?: string; pubdate?: number; created?: number; play?: number
    review?: number; comment?: number; description?: string; desc?: string
    pic?: string; tname?: string; stat?: { view: number; reply: number }; pages?: { cid: number }[]
}

export function video(raw: RawVideo, source: string): Video {
    const bvid = raw.bvid || ''
    return {
        bvid, aid: raw.aid || 0, cid: raw.cid || raw.pages?.[0]?.cid || 0,
        title: (raw.title || '').replace(/<[^>]*>/g, ''),
        author: raw.owner?.name || raw.author || '', uid: String(raw.owner?.mid || raw.mid || ''),
        duration: duration(raw.duration || raw.length || 0), pubdate: raw.pubdate || raw.created || 0,
        play: raw.stat?.view || raw.play || 0, comments: raw.stat?.reply || raw.review || raw.comment || 0,
        description: raw.desc || raw.description || '', pic: raw.pic || undefined,
        tname: typeof raw.tname === 'string' && raw.tname ? raw.tname : undefined,
        url: `https://www.bilibili.com/video/${bvid}`, sources: [source]
    }
}

/** 业务层：只负责把 B站原始数据归一化，网络与登录都在 bili.ts / http.ts 里 */
export class Api {
    constructor(readonly cfg: Config, readonly bot: BiliBot) {}

    /** 原生客户端的完整类型：BiliBot 里只声明了旧方法，新读接口走这里转一手 */
    private get native(): NativeBili {
        return (this.bot as unknown as { internal: NativeBili }).internal
    }

    async search(keyword: string, order: 'totalrank' | 'pubdate' | 'click' | 'dm' | 'stow' | 'scores' | 'attention' = 'totalrank', page = 1): Promise<Video[]> {
        return (await this.bot.internal.searchVideos(keyword, { order, page })).map((item) => video(item, `kw:${keyword}`))
    }

    async info(bvid: string): Promise<Video> {
        const result = await this.bot.internal.getVideoInfo(bvid)
        if (!result) throw new Error(`无法读取视频 ${bvid}，请检查登录状态和插件日志`)
        return video(result, 'info')
    }

    async resolve(name: string): Promise<{ id: string; name: string }> {
        if (/^\d+$/.test(name)) {
            const user = await this.bot.getUser(name)
            if (!user?.name) throw new Error(`无法获取用户 ${name} 的昵称`)
            return { id: name, name: user.name }
        }
        const users = await this.bot.internal.searchUsersByName(name, true)
        const user = users.find((item) => item.uname === name)
        if (!user) throw new Error(`找不到精确昵称：${name}`)
        return { id: String(user.mid), name: user.uname }
    }

    async up(name: string, days: number): Promise<Video[]> {
        const user = await this.resolve(name)
        return (await this.bot.internal.getUserVideos(user.id, { days })).map((item) => ({
            ...item, author: item.author || user.name, sources: [`up:${user.id}`]
        }))
    }

    async related(bvid: string): Promise<Video[]> {
        return (await this.bot.internal.getRelatedVideos(bvid)).slice(0, 18).map((item) => ({ ...item, sources: [`related:${bvid}`] }))
    }

    comments(item: Video, limit = 30, root?: string, anonymous = false): Promise<Comment[]> {
        return this.bot.internal.getVideoComments(item.bvid, { limit, root, anonymous })
    }

    async subtitle(item: Video): Promise<string> {
        return (await this.bot.internal.getVideoSubtitle(item.bvid)).text
    }

    async summary(item: Video): Promise<{ summary: string; outline: { title: string; timestamp: number; parts: { timestamp: number; content: string }[] }[] } | undefined> {
        if (!item.cid || !/^\d+$/.test(item.uid)) return
        const data = await this.bot.internal.getVideoConclusion(item.bvid, item.cid, Number(item.uid))
        const result = data?.model_result as {
            summary?: string
            outline?: { title: string, timestamp: number, part_outline?: { timestamp: number, content: string }[] }[]
        } | undefined
        if (!result?.summary) return
        return {
            summary: result.summary,
            outline: (result.outline || []).map((row) => ({
                title: row.title, timestamp: row.timestamp,
                parts: (row.part_outline || []).map((part) => ({ timestamp: part.timestamp, content: part.content }))
            }))
        }
    }

    async audio(bvid: string, maxDuration: number) {
        if (typeof this.bot.internal.getVideoAudio !== 'function') throw new Error('当前客户端不支持读取音轨')
        return this.bot.internal.getVideoAudio(bvid, { maxDuration })
    }

    /** Top-level comment. Returns the new comment rpid. */
    sendComment(item: Video, text: string, mentions: { id: string; name: string }[]): Promise<string> {
        return this.bot.internal.createVideoComment(item.bvid, text, mentions)
    }

    /** Reply to an existing comment. replyTo is the direct target rpid; root is the thread root. */
    async reply(item: Video, text: string, replyTo: string, root: string, mentions: { id: string; name: string }[] = []): Promise<string> {
        const id = await this.bot.internal.sendComment(`video:${item.aid}`, text, {
            oid: item.aid, type: 1, rpid: Number(replyTo), root: Number(root), parent: Number(replyTo)
        }, mentions)
        if (!id) throw new Error('B站未返回评论 ID，发送结果未知，请勿直接重发')
        return id
    }

    follow(uid: string, action: 'follow' | 'unfollow'): Promise<boolean> {
        return action === 'follow' ? this.bot.internal.followUser(uid) : this.bot.internal.unfollowUser(uid)
    }

    isFollowing(uid: string): Promise<boolean> {
        return this.bot.internal.isFollowing(uid)
    }

    /** 收藏到指定收藏夹 */
    async favorite(bvid: string, folderId: number): Promise<boolean> {
        await this.native.addVideoToFavorite(bvid, folderId)
        return true
    }

    /** 从指定收藏夹取消收藏 */
    async unfavorite(bvid: string, folderId: number): Promise<boolean> {
        await this.native.removeVideoFromFavorite(bvid, folderId)
        return true
    }

    userInfo(uid: string): Promise<unknown> {
        return this.bot.internal.getUserInfo(uid)
    }

    searchUsers(keyword: string, page = 1) {
        return this.bot.internal.searchUsers(keyword, { page })
    }

    dm(target: string, content: h.Fragment): Promise<string[]> {
        return this.bot.sendPrivateMessage(target, content)
    }

    messages(uid: string, limit = 20) {
        return this.bot.getMessageList(`private:${uid}`, undefined, 'before', limit)
    }

    visible(item: Video, rpid: string, root?: string) { return this.bot.internal.getCommentVisibility(item.bvid, rpid, root) }

    // #region 契约 4：数据读取（读接口在 bili.ts 里已经兜底，这里只做归一化）

    /** 视频统计：点赞/投币/收藏/分享/弹幕 */
    async stats(item: Video): Promise<VideoStats> {
        const stat = await this.native.getVideoStats(item.bvid)
        const value = (input: unknown) => (Number.isFinite(Number(input)) ? Number(input) : 0)
        return {
            like: value(stat?.like),
            coin: value(stat?.coin),
            favorite: value(stat?.favorite),
            share: value(stat?.share),
            danmaku: value(stat?.danmaku),
        }
    }

    /** 弹幕，按时间升序 */
    async danmaku(item: Video, limit = 50): Promise<{ time: number, text: string }[]> {
        const rows = await this.native.getVideoDanmaku(item.bvid, { limit, cid: item.cid, aid: item.aid })
        return rows
            .filter((row) => row && Number.isFinite(row.time) && row.text)
            .map((row) => ({ time: row.time, text: row.text }))
            .sort((a, b) => a.time - b.time)
    }

    /** 首页推荐流（需登录；失败返回空数组） */
    async recommend(ps = 30): Promise<Video[]> {
        return (await this.native.getRecommend(ps)).map((raw) => video(raw, 'recommend'))
    }

    /** 收藏夹列表；未登录抛错 */
    favoriteFolders(): Promise<{ id: number, title: string, count: number }[]> {
        return this.native.getFavoriteFolders()
    }

    /** 视频是否已在某收藏夹；失败按「不在」处理 */
    inFavorite(item: Video, folderId: number): Promise<boolean> {
        return this.native.isInFavorite(item.bvid, folderId)
    }

    /** 粉丝数 / 关注数 / 投稿数 */
    async userStat(uid: string): Promise<{ fans: number, following: number, videos: number }> {
        const stat = await this.native.getUserStat(String(uid || ''))
        const value = (input: unknown) => (Number.isFinite(Number(input)) ? Number(input) : 0)
        return { fans: value(stat?.fans), following: value(stat?.following), videos: value(stat?.videos) }
    }

    /** 收到的 @ 与回复；未登录抛错 */
    inbox(limit = 20): Promise<InboxItem[]> {
        return this.native.getInbox({ limit })
    }

    /** 未读私信数；失败返回 0 */
    unread(): Promise<number> {
        return this.native.getUnread()
    }

    // #endregion
}
