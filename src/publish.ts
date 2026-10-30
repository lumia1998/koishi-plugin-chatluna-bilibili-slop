import { h, type Context, type Fragment, type Session } from 'koishi'
import type { Api } from './api.js'
import type { InteractionLog } from './interactions.js'
import type { Settings } from './settings.js'
import type { Store } from './store.js'
import { clock } from './summary.js'
import type { Mention, Publication, ShuttleRecord, Video } from './types.js'

/** 一级评论上限（含链接） */
const COMMENT_LIMIT = 150
/** 私信上限 */
const DM_LIMIT = 470
/** 每小时全局限速窗口 */
const RATE_WINDOW = 3600_000
/** commentPerHour 缺省值，与 service.ts 保持一致 */
const RATE_DEFAULT = 10

export type Channel = 'comment' | 'dm' | 'group'

export interface PublishContext {
    ctx: Context
    settings: Settings
    api: Api
    store: Store
    /** 调用工具的会话：群推送直接发回这个会话，不再靠配置里的频道列表 */
    session?: Session
    /** 互动时间线：私信投递也记一条，可省略 */
    interactions?: InteractionLog
    logger: { info(...args: any[]): void, warn(...args: any[]): void }
}

/** 正文里不能出现 ASCII @：B站靠 at_name_to_mid 建映射，正文的 @ 反而会被当成普通符号 */
function sanitize(text: string | undefined): string {
    return (text || '').replace(/@/g, '＠').replace(/\s+/g, ' ').trim()
}

function linkOf(record: ShuttleRecord): string {
    return record.url || `https://www.bilibili.com/video/${record.bvid}`
}

/** 按剩余字数裁理由，末尾留一个省略号 */
function fit(text: string, budget: number): string {
    const body = sanitize(text)
    if (!body || budget <= 0) return ''
    if (body.length <= budget) return body
    return budget <= 1 ? '' : body.slice(0, budget - 1) + '…'
}

/** 评论正文 = 搬运理由 + 链接；链接无论如何都保留，只截理由 */
function commentText(record: ShuttleRecord): string {
    const link = linkOf(record)
    const reason = fit(record.reason, COMMENT_LIMIT - link.length - 1)
    return reason ? `${reason}\n${link}` : link
}

/** 私信正文（纯函数）：标题 / UP · 链接 / 理由，总长 ≤470 */
export function dmText(record: ShuttleRecord): string {
    const link = linkOf(record)
    const head = `${sanitize(record.title) || record.bvid}\n${sanitize(record.author) || '未知 UP'} · ${link}`
    const label = '\n理由：'
    const reason = fit(record.reason, DM_LIMIT - head.length - label.length)
    const body = reason ? `${head}${label}${reason}` : head
    return body.length > DM_LIMIT ? `${body.slice(0, DM_LIMIT - 1)}…` : body
}

/** 群推送卡片（纯函数）：风格与 push.ts 的 slopCard 一致 */
export function groupCard(record: ShuttleRecord): Fragment {
    const lines: h[] = []
    if (record.pic) lines.push(h.image(record.pic))

    const head = `${sanitize(record.title) || record.bvid}\n${sanitize(record.author) || '未知 UP'} · ${linkOf(record)}`
    const meta = [`时长 ${clock(record.duration)}`]
    if (typeof record.atRatio === 'number') meta.push(`@率 ${record.atRatio.toFixed(2)}`)
    if (typeof record.score === 'number') meta.push(`得分 ${record.score}`)

    const evidence = record.evidence?.[0]
        ? `\n热评：${sanitize(record.evidence[0])}` : ''
    const reason = sanitize(record.reason)
        ? `\n搬运理由：${sanitize(record.reason)}` : ''

    lines.push(h.text(`${head}\n${meta.join(' · ')}${evidence}${reason}`))
    return lines
}

/** api.sendComment 只要 bvid（aid 由 createVideoComment 自己查），这里补齐 Video 的其余字段 */
function toVideo(record: ShuttleRecord): Video {
    return {
        bvid: record.bvid, aid: 0, cid: 0, title: record.title, author: record.author,
        uid: record.uid, duration: record.duration, pubdate: 0, play: 0, comments: 0,
        description: '', url: linkOf(record), pic: record.pic, sources: ['shuttle'],
    }
}

/** 插件构造 @ 列表：主人 + 额外 UID，去重、只保留纯数字 */
async function collectMentions(pub: PublishContext): Promise<Mention[]> {
    const uids = [pub.settings.ownerUid, ...(pub.settings.mentionUids || [])]
        .map((uid) => String(uid ?? '').trim())
        .filter((uid, index, all) => /^\d+$/.test(uid) && all.indexOf(uid) === index)
    const mentions: Mention[] = []
    for (const uid of uids) {
        try {
            const user = await pub.api.bot.getUser(uid)
            if (user?.name) mentions.push({ id: uid, name: user.name })
            else pub.logger.warn('@ 目标 %s 取不到昵称，已跳过', uid)
        } catch (err) {
            pub.logger.warn('@ 目标 %s 查询失败：%s', uid, (err as Error).message)
        }
    }
    if (!mentions.length) pub.logger.warn('没有可用的 @ 目标，评论将不带 @ 发布')
    return mentions
}

/**
 * 评论区 @ 主人。同一账号同一视频只发一条一级评论；失败记 'unknown' 且不重发。
 * 返回 false 表示跳过（已发过），不算成功通道。
 */
async function publishComment(pub: PublishContext, record: ShuttleRecord): Promise<boolean> {
    const { api, store, settings, logger } = pub
    const account = api.bot.selfId
    const key = `${account}:${record.bvid}`

    if (store.state.comments[key]) {
        logger.info('评论跳过：%s 已发过一级评论（%s）', record.bvid, store.state.comments[key].state)
        return false
    }

    // 昵称查询放在落账之前：查不到就退回无 @，绝不会让台账卡在 sending
    const mentions = await collectMentions(pub)
    const text = commentText(record)

    const ledger = await store.locked(async (): Promise<Publication | undefined> => {
        // 台账只在网络请求前后短锁，绝不在里面 await 网络
        if (store.state.comments[key]) return undefined
        const limit = Math.max(1, settings.commentPerHour ?? RATE_DEFAULT)
        const hourAgo = Date.now() - RATE_WINDOW
        const recent = Object.values(store.state.comments)
            .filter((item) => item.account === account && Date.parse(item.at) > hourAgo)
        if (recent.length >= limit) throw new Error(`评论发送超出每小时 ${limit} 条的全局限速`)
        const record_: Publication = { account, bvid: record.bvid, text, at: new Date().toISOString(), state: 'sending' }
        store.state.comments[key] = record_
        await store.save()
        return record_
    })
    if (!ledger) {
        logger.info('评论跳过：%s 刚被别的任务发过', record.bvid)
        return false
    }

    try {
        ledger.rpid = await api.sendComment(toVideo(record), text, mentions)
        ledger.state = 'sent'
    } catch (err) {
        ledger.state = 'unknown'
        await store.locked(() => store.save())
        throw new Error(`评论发送结果未知：${(err as Error).message}；插件已记账，不会自动重发`)
    }
    await store.locked(() => store.save())
    logger.info('评论已发送：%s（rpid %s）', record.bvid, ledger.rpid)
    return true
}

/** B站私信；收件人 dmUid，回落到 ownerUid */
async function publishDm(pub: PublishContext, record: ShuttleRecord): Promise<boolean> {
    const target = String(pub.settings.dmUid || '').trim() || String(pub.settings.ownerUid || '').trim()
    if (!/^\d+$/.test(target)) {
        pub.logger.warn('私信投递跳过：dmUid 与 ownerUid 都没配置')
        return false
    }
    const ids = await pub.api.dm(target, [h.text(dmText(record))])
    if (!ids?.length) throw new Error('适配器未返回私信 ID，发送结果未知')
    // 时间线只是展示，记不上不影响投递结果
    await pub.interactions?.add([{
        id: `dm:${ids[0]}`, direction: 'out', kind: 'dm', at: new Date().toISOString(),
        bvid: record.bvid, title: record.title, peerUid: target, text: dmText(record),
    }]).catch(() => {})
    pub.logger.info('私信已发送：%s → %s', record.bvid, target)
    return true
}

/**
 * 推送到调用工具的会话：在哪个群调的工具就发回哪个群，私聊调用就发回私聊。
 * 没有会话（控制台手动搬运、定时任务）时明确跳过，不猜频道。
 */
async function publishGroup(pub: PublishContext, record: ShuttleRecord): Promise<boolean> {
    const session = pub.session
    if (!session) {
        pub.logger.info('群推送跳过：%s 没有会话上下文（控制台手动搬运不推群）', record.bvid)
        return false
    }
    await session.send(groupCard(record))
    pub.logger.info('会话推送已发送：%s → %s%s', record.bvid, session.platform, session.channelId)
    return true
}

/**
 * 三条通道互相独立：任意一条失败只记日志，不影响其它两条；整体不抛异常。
 * 返回实际成功的通道（跳过的不算）。
 */
export async function deliver(pub: PublishContext, record: ShuttleRecord): Promise<Channel[]> {
    const done: Channel[] = []
    const run = async (name: Channel, task: () => Promise<boolean>) => {
        try {
            if (await task()) done.push(name)
        } catch (err) {
            pub.logger.warn('%s 投递 %s 失败：%s', name, record.bvid, (err as Error).message)
        }
    }

    if (pub.settings.publishComment) await run('comment', () => publishComment(pub, record))
    if (pub.settings.publishDm) await run('dm', () => publishDm(pub, record))
    if (pub.settings.publishGroup) await run('group', () => publishGroup(pub, record))
    return done
}
