import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { Context } from 'koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import type { Store } from './store.js'
import { pick } from './summary.js'
import type { ShuttleRecord } from './types.js'

/** 喂给模型的正文上限：留足够上下文，又不至于把长视频撑爆上下文窗口 */
const CONTENT_LIMIT = 600
/** 一天最多写多少条进提示词；再多模型也会开始糊 */
const RECORD_LIMIT = 40
/** 生成超时：普通模型够用，慢一点的推理模型也不至于被硬砍 */
const REPORT_TIMEOUT = 120_000

/** 控制台模型下拉框的一项 */
export interface ReportModel {
    /** 全名，`platform/name`，写回 settings.summaryModel 的就是这个 */
    name: string
    /** 平台名，用于 awaitLoadPlatform */
    platform: string
}

/**
 * 列出 ChatLuna 已加载的对话模型。
 *
 * 和 chatluna-memes 的做法一致：`listAllModels(1)`（1 = ModelType.llm）。
 * chatluna 是必装依赖，但平台侧可能一个都没配好，这时候给空数组而不是抛错，
 * 面板上显示「没有可用模型」比报错有用。
 */
export function listModels(ctx: Context): ReportModel[] {
    try {
        const models = ctx.chatluna?.platform?.listAllModels(1)?.value || []
        return models
            .map((model) => {
                const name = model.toModelName?.()
                if (!name) return undefined
                const platform = name.slice(0, name.indexOf('/'))
                return platform ? { name, platform } : undefined
            })
            .filter((item): item is ReportModel => !!item)
            .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
        return []
    }
}

/** 一条记录压成提示词里的一段；content 截断，理由保留原样 */
function describe(record: ShuttleRecord): string {
    const lines = [
        `- 《${record.title || record.bvid}》 作者：${record.author || '未知'}（UID ${record.uid || '未知'}）`,
        `  搬运理由：${record.reason || '（无）'}`,
    ]
    if (record.duration) lines.push(`  时长：${Math.round(record.duration)} 秒`)
    if (typeof record.play === 'number') lines.push(`  播放：${record.play}`)
    if (typeof record.comments === 'number') lines.push(`  评论：${record.comments}`)
    const content = (record.content || '').replace(/\s+/g, ' ').trim()
    if (content) lines.push(`  内容：${content.slice(0, CONTENT_LIMIT)}`)
    return lines.join('\n')
}

/** 把一天的搬运记录拼成提示词正文；没有记录返回空串 */
export function digest(store: Store, day: string): string {
    const records = pick(store, day).slice(0, RECORD_LIMIT)
    if (!records.length) return ''
    return records.map(describe).join('\n\n')
}

const SYSTEM = [
    '你在给一个「刷B站」插件写日报。插件会按用户偏好把 B站视频搬到自己这边，',
    '每条记录里有标题、作者、搬运理由和内容摘要。',
    '请写一篇当天日报：先用两三句话总结今天的整体口味与共同点，再逐条用一两句话点出每条视频讲了什么、为什么值得看。',
    '只依据给出的信息，不要编造视频里没提到的内容；信息不足时就写得克制一些。',
    '用中文，Markdown 排版：开头一个二级标题，下面用无序列表。不要写「根据提供的信息」这类元话术。',
].join('')

/**
 * 调模型写日报。
 *
 * 模型全名从 settings.summaryModel 来（控制台配置页选的），为空直接抛错，
 * 由调用方决定是提示用户去配置还是悄悄退回静态日报。
 */
export async function aiReport(ctx: Context, store: Store, day: string, modelName: string): Promise<string> {
    const name = String(modelName || '').trim()
    if (!name) throw new Error('没有选择日报模型：请到「配置页 → 日报」里选一个 ChatLuna 模型')
    const body = digest(store, day)
    if (!body) throw new Error(`${day} 没有搬运记录，没什么可总结的`)

    const slash = name.indexOf('/')
    const platform = slash > 0 ? name.slice(0, slash) : ''
    if (platform) await ctx.chatluna.awaitLoadPlatform(platform)

    const model = await ctx.chatluna.createChatModel(name)
    if (!model?.value) throw new Error(`模型 ${name} 不可用，检查 ChatLuna 里这个平台是否已配置并启用`)

    const reply = await model.value.invoke([
        new SystemMessage(SYSTEM),
        new HumanMessage(`${day} 的搬运记录：\n\n${body}`),
    ], { timeout: REPORT_TIMEOUT })

    const text = getMessageContent(reply.content).trim()
    if (!text) throw new Error('模型没有返回内容')
    return text
}
