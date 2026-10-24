import { h, type Context, type Session } from 'koishi'
import type Sst from '@initencounter/sst'
import type { Api } from './api.js'

const ASR_MAX_DURATION = 1800

// Avoid filling a single-provider SST service with parallel requests.
let queue: Promise<unknown> = Promise.resolve()

interface SstLike extends Partial<Sst> {
    transcribe?: (buffer: Buffer) => Promise<string>
}

export function transcribe(ctx: Context, api: Api, bvid: string): Promise<string> {
    const job = queue.then(async () => {
        const service = () => {
            if (!ctx.scope.isActive) throw new Error('语音转写已取消')
            const sst = ctx.get('sst') as SstLike | undefined
            if (typeof sst?.transcribe !== 'function' && typeof sst?.audio2text !== 'function') {
                throw new Error('未加载 sst 语音识别服务，请启用 doubao-asr 等 sst 提供者')
            }
            return sst
        }
        service()
        const audio = await api.audio(bvid, ASR_MAX_DURATION)
        const sst = service()
        let text: string | undefined
        if (typeof sst.transcribe === 'function') {
            text = await sst.transcribe(audio.data)
        } else {
            const element = h.audio(audio.data, 'audio/mp4')
            // Koishi decorates the Satori session returned by the Bot factory at runtime.
            const session = api.bot.session({
                type: 'message',
                message: { elements: [element], content: element.toString() }
            }) as Session
            text = await sst.audio2text!(session)
        }
        if (!ctx.scope.isActive) throw new Error('语音转写已取消')
        if (typeof text !== 'string') throw new Error('sst 服务返回了无效的识别结果')
        if (text.length > 200000) throw new Error('sst 识别文本超过长度限制')
        return text.trim()
    })
    queue = job.catch(() => {})
    return job
}
