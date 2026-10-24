import { Schema } from 'koishi'

export interface Config {
    selfId: string
    ownerUid: string
    authority: number
    allowedUsers: string[]
    allowComment: boolean
    allowDm: boolean
    dmWhitelist: string[]
    allowFollow: boolean
    transcribe: boolean
    keywords: string[]
    ups: string[]
    channels: string[]
    pushTimes: string[]
    pushCount: number
    watchUps: string[]
    watchInterval: number
}

export const DEFAULT_UPS = ['互联网粪王', '你爱咋想咋想吧', '地球online神人集合', '坤坤是条闲鱼', '抽象搬运工258', '番茄青蛙-', 'funnybite', '沈井彬-擒史皇']

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        selfId: Schema.string().default('').description('已登录的 B站机器人 UID。只有一个 B站机器人时可留空。'),
        ownerUid: Schema.string().default('').description('主人的 B站 UID。用于评论 @ 和默认私信收件人。')
    }).description('账号'),
    Schema.object({
        authority: Schema.number().min(0).max(5).default(3).description('使用 B站工具的最低 Koishi 权限等级。'),
        allowedUsers: Schema.array(String).default([]).description('额外允许使用工具的用户，格式 platform:userId。')
    }).description('权限'),
    Schema.object({
        allowComment: Schema.boolean().default(false).description('允许通过 bili_comment 在 B站发评论和回复。'),
        allowDm: Schema.boolean().default(false).description('允许通过 bili_dm 发送 B站私信；关闭时仍可读取私信。'),
        dmWhitelist: Schema.array(String).default([]).description('允许发送私信的 UID 白名单，主人 UID 始终允许。'),
        allowFollow: Schema.boolean().default(false).description('允许通过 bili_follow 关注和取关 UP 主。'),
        transcribe: Schema.boolean().default(false).description('无字幕且无 AI 总结时，通过 sst 服务转写音轨，需要启用 doubao-asr 等提供者。')
    }).description('能力'),
    Schema.object({
        keywords: Schema.array(String).default([]).description('找屎搜索关键词，留空使用默认词。'),
        ups: Schema.array(String).default(DEFAULT_UPS).description('找屎追踪的 UP 主 UID 或精确昵称。')
    }).description('找屎'),
    Schema.object({
        channels: Schema.array(String).default([]).description('定时推送的目标频道，格式 platform:channelId；留空关闭全部推送。'),
        pushTimes: Schema.array(String).default([]).description('每天找屎搬运的时间点（Asia/Shanghai），例如 ["12:00", "20:00"]。'),
        pushCount: Schema.number().min(1).max(10).step(1).default(3).description('每次搬运推送的视频数。'),
        watchUps: Schema.array(String).default([]).description('监听新投稿的 UP 主 UID 或精确昵称。'),
        watchInterval: Schema.number().min(10).max(1440).step(1).default(30).description('检查 UP 新投稿的间隔（分钟）。')
    }).description('搬运')
]) as Schema<Config>
