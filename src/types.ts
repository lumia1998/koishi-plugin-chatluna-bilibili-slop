import type { h } from 'koishi'

export interface Mention {
    id: string
    name: string
}

export interface Video {
    bvid: string
    aid: number
    cid: number
    title: string
    author: string
    uid: string
    duration: number
    pubdate: number
    play: number
    comments: number
    description: string
    url: string
    pic?: string
    /** 分区名，来自 `tname`；拿不到时为空，偏好过滤会放行 */
    tname?: string
    sources: string[]
}
export interface Comment {
    rpid: string
    root: string
    parent: string
    uid: string
    name: string
    text: string
    likes: number
    mentions: boolean
}
export interface Ranked extends Video {
    score: number
    atRatio: number
    pureAtRatio: number
    feedRatio: number
    evidence: string[]
    fromUp: boolean
    series: boolean
    mygo: boolean
}
export interface Candidate extends Video {
    rank?: Ranked
    hotComments: Comment[]
}
export interface Publication {
    account: string
    bvid: string
    at: string
    text: string
    rpid?: string
    root?: string
    parent?: string
    state: 'sending' | 'sent' | 'unknown'
    visible?: 'public' | 'pending' | 'missing'
    checkedAt?: string
}
export interface Transcript {
    text: string
    source: 'subtitle' | 'asr'
    at: number
}
/** 视频数据：点赞/投币/收藏/分享/弹幕，供「看视频」工具展示 */
export interface VideoStats {
    like: number
    coin: number
    favorite: number
    share: number
    danmaku: number
}

/** 一条搬运记录：控制台「搬运历史」与日报的数据源 */
export interface ShuttleRecord {
    bvid: string
    title: string
    author: string
    uid: string
    url: string
    pic?: string
    duration: number
    /** ISO 时间 */
    at: string
    /** 模型现场写的搬运理由（为什么搬这条） */
    reason: string
    /** 内容摘要，给搬运历史详情用 */
    content?: string
    /** 播放 / 评论数快照，日报与照片墙详情用 */
    play?: number
    comments?: number
    score?: number
    atRatio?: number
    evidence?: string[]
    delivery: ('comment' | 'dm' | 'group')[]
}

/** 一条观看记录：`bili_video` 每次成功解析视频时写一条，控制台「观看历史」的数据源 */
export interface ViewRecord {
    bvid: string
    title: string
    author: string
    uid: string
    url: string
    pic?: string
    duration: number
    /** ISO 时间 */
    at: string
    /** 这次读到的正文来自哪里 */
    source?: 'subtitle' | 'asr' | 'summary' | 'none'
}

/** B站 @ 提醒 / 回复提醒 */
export interface InboxItem {
    id: string
    kind: 'reply' | 'at' | 'like' | 'dm'
    fromUid: string
    fromName: string
    bvid?: string
    rpid?: string
    text: string
    at: number
    /** 来源：视频评论 / 楼中楼 / 私信 */
    scope?: 'video' | 'thread' | 'dm'
}
export interface State {
    version: 4
    comments: Record<string, Publication>
    transcripts: Record<string, Transcript>
    shown: Record<string, number>
    watch: Record<string, number>
    /** v3：搬运记录，照片墙与日报的数据源 */
    shuttles: Record<string, ShuttleRecord>
    /** v4：看过的视频，控制台「观看历史」的数据源 */
    views: Record<string, ViewRecord>
}
/**
 * 插件内部当作 bot 用的最小门面（原生实现，不再依赖适配器的 Bot 类型）。
 * 只声明 api.ts / service.ts 真正会用到的方法。
 */
export interface BiliBot {
    platform: string
    selfId: string
    internal: {
        getVideoInfo(bvid: string): Promise<any>
        getVideoSubtitle(bvid: string, item?: any): Promise<{ text: string }>
        getVideoConclusion(bvid: string, cid: number, upMid: number): Promise<any | null>
        getVideoComments(bvid: string, options?: { limit?: number, root?: string, anonymous?: boolean, sort?: 'hot' | 'time' }): Promise<Comment[]>
        getVideoAudio?(bvid: string, options?: { maxDuration?: number }): Promise<{ data: Buffer }>
        getRelatedVideos(bvid: string): Promise<any[]>
        getUserVideos(uid: string, options?: { days?: number }): Promise<any[]>
        getUserInfo(uid: string): Promise<any>
        searchVideos(keyword: string, options?: { order?: string, page?: number }): Promise<any[]>
        searchUsers(keyword: string, options?: { page?: number }): Promise<any[]>
        searchUsersByName(name: string, exactMatch?: boolean): Promise<any[]>
        createVideoComment(bvid: string, text: string, mentions?: Mention[]): Promise<string>
        sendComment(channelId: string, text: string, target: { oid: number, type: number, rpid: number, root: number, parent: number }, mentions?: Mention[]): Promise<string | null>
        getCommentVisibility(bvid: string, rpid: string, root?: string): Promise<'public' | 'pending' | 'missing'>
        followUser(uid: string): Promise<boolean>
        unfollowUser(uid: string): Promise<boolean>
        isFollowing(uid: string): Promise<boolean>
        addVideoToFavorite?(bvid: string, folderId: string | number): Promise<any>
    }
    getUser(id: string): Promise<{ id: string, name: string }>
    sendPrivateMessage(id: string, content: h.Fragment): Promise<string[]>
    getMessageList(channelId: string, next?: string, direction?: string, limit?: number): Promise<{ data: any[] }>
    session(payload: any): any
}
