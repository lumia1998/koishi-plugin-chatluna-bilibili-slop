import { h, type Context } from 'koishi'
import type { Config } from './config.js'
import { duration } from './score.js'
import type { BiliBot, Comment, Video } from './types.js'

interface RawVideo {
    bvid?: string; aid?: number; cid?: number; title?: string; author?: string
    mid?: number; owner?: { name: string; mid: number }; duration?: string | number
    length?: string; pubdate?: number; created?: number; play?: number
    review?: number; comment?: number; description?: string; desc?: string
    pic?: string; stat?: { view: number; reply: number }; pages?: { cid: number }[]
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
        url: `https://www.bilibili.com/video/${bvid}`, sources: [source]
    }
}

/** Business adapter only: Bilibili requests and authentication belong to the Lumia adapter. */
export class Api {
    constructor(readonly cfg: Config, readonly bot: BiliBot) {}

    async search(keyword: string, order: 'totalrank' | 'pubdate' | 'click' | 'dm' | 'stow' | 'scores' | 'attention' = 'totalrank', page = 1): Promise<Video[]> {
        return (await this.bot.internal.searchVideos(keyword, { order, page })).map((item) => video(item, `kw:${keyword}`))
    }

    async info(bvid: string): Promise<Video> {
        const result = await this.bot.internal.getVideoInfo(bvid)
        if (!result) throw new Error(`无法读取视频 ${bvid}，请检查登录状态和适配器日志`)
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
        const result = data?.model_result
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
        if (typeof this.bot.internal.getVideoAudio !== 'function') throw new Error('音轨读取需要 Lumia B站适配器 0.1.2 或更新版本')
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
        if (!id) throw new Error('适配器未返回评论 ID，发送结果未知，请勿直接重发')
        return id
    }

    follow(uid: string, action: 'follow' | 'unfollow'): Promise<boolean> {
        return action === 'follow' ? this.bot.internal.followUser(uid) : this.bot.internal.unfollowUser(uid)
    }

    isFollowing(uid: string): Promise<boolean> {
        return this.bot.internal.isFollowing(uid)
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
}

export function account(ctx: Context, cfg: Config): BiliBot {
    const bots = ctx.bots.filter((bot) => bot.platform === 'bilibili' && (!cfg.selfId || bot.selfId === cfg.selfId))
    if (bots.length !== 1) throw new Error(bots.length ? '存在多个 B站机器人，请配置 selfId' : '请先启用 @lumia.wang/adapter-bilibili 并扫码登录')
    const bot = bots[0] as unknown as BiliBot
    const methods = ['getVideoSubtitle', 'getVideoComments', 'getUserVideos', 'getRelatedVideos', 'createVideoComment', 'getCommentVisibility', 'searchVideos', 'searchUsers', 'searchUsersByName', 'getVideoInfo', 'getVideoConclusion', 'getUserInfo', 'followUser', 'unfollowUser', 'isFollowing', 'sendComment'] as const
    if (methods.some((method) => typeof bot.internal?.[method] !== 'function')) {
        throw new Error('请使用 @lumia.wang/koishi-plugin-adapter-bilibili 0.1.2 或更新版本')
    }
    return bot
}
