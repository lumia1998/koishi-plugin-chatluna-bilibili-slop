import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Bot, Context, h, type Session } from 'koishi'
import type { Api } from '../src/api.js'
import { transcribe } from '../src/asr.js'

function fixture(provider?: { audio2text?(session: Session): Promise<string>; transcribe?(buffer: Buffer): Promise<string> }) {
    const native = new Context()
    // A real Session factory without starting or registering a network adapter.
    const bot = Object.assign(Object.create(Bot.prototype), { ctx: native, platform: 'bilibili', user: { id: '42' } })
    const ctx = { scope: { isActive: true }, get: (name: string) => name === 'sst' ? provider : undefined } as unknown as Context
    let downloads = 0
    const bytes = Buffer.from('m4a test audio')
    const api = { bot, audio: async () => { downloads++; return { data: bytes } } } as unknown as Api
    return { ctx, api, bytes, downloads: () => downloads, close: () => native.stop() }
}

test('sst 提供 transcribe(buffer) 快路径时直接传 Buffer', async () => {
    let received: Buffer | undefined
    const f = fixture({ transcribe: async (buffer) => { received = buffer; return '  快路径结果  ' } })
    try {
        assert.equal(await transcribe(f.ctx, f.api, 'BV1xx411c7mD'), '快路径结果')
        assert.deepEqual(received, f.bytes)
        assert.equal(f.downloads(), 1)
    } finally { await f.close() }
})

test('只有 audio2text 时用独立的真实 Koishi Session 调用', async () => {
    let received: Session | undefined
    const f = fixture({ audio2text: async session => { received = session; return '  完整转写结果  ' } })
    try {
        assert.equal(await transcribe(f.ctx, f.api, 'BV1xx411c7mD'), '完整转写结果')
        assert.equal(received?.constructor.name, 'Session')
        assert.ok(received)
        assert.equal(received.bot, f.api.bot)
        assert.equal(received.elements.length, 1)
        const element = h.select(received.elements, 'audio')[0]
        assert.equal(element.attrs.src, 'data:audio/mp4;base64,' + f.bytes.toString('base64'))
    } finally { await f.close() }
})

test('sst 缺失时在下载前报错，服务异常不伪装为空转写', async () => {
    const missing = fixture()
    try {
        await assert.rejects(transcribe(missing.ctx, missing.api, 'BV1xx411c7mD'), /未加载 sst/)
        assert.equal(missing.downloads(), 0)
    } finally { await missing.close() }
    const upstream = new Error('提供者连接超时')
    const failed = fixture({ audio2text: async () => { throw upstream } })
    try { await assert.rejects(transcribe(failed.ctx, failed.api, 'BV1xx411c7mD'), error => error === upstream) }
    finally { await failed.close() }
})

test('空文本和错误返回类型分别处理', async () => {
    const empty = fixture({ audio2text: async () => ' \n ' })
    try { assert.equal(await transcribe(empty.ctx, empty.api, 'BV1xx411c7mD'), '') }
    finally { await empty.close() }
    const invalid = fixture({ audio2text: async () => undefined as unknown as string })
    try { await assert.rejects(transcribe(invalid.ctx, invalid.api, 'BV1xx411c7mD'), /无效的识别结果/) }
    finally { await invalid.close() }
})

test('识别请求串行执行，失败不会卡住后续队列', async () => {
    let active = 0, peak = 0, calls = 0
    const f = fixture({ audio2text: async () => {
        peak = Math.max(peak, ++active)
        try {
            await new Promise(resolve => setTimeout(resolve, 4))
            if (++calls === 1) throw new Error('第一次失败')
            return '下一次成功'
        } finally { active-- }
    } })
    try {
        const result = await Promise.allSettled([
            transcribe(f.ctx, f.api, 'BV1xx411c7mD'),
            transcribe(f.ctx, f.api, 'BV1xx411c7mD')
        ])
        assert.equal(result[0].status, 'rejected')
        assert.deepEqual(result[1], { status: 'fulfilled', value: '下一次成功' })
        assert.equal(peak, 1)
    } finally { await f.close() }
})

test('下载期间插件停用后，不再调用 sst', async () => {
    let calls = 0
    const f = fixture({ audio2text: async () => { calls++; return '不应调用' } })
    f.api.audio = async () => { (f.ctx.scope as unknown as { isActive: boolean }).isActive = false; return { data: f.bytes } as Awaited<ReturnType<Api['audio']>> }
    try {
        await assert.rejects(transcribe(f.ctx, f.api, 'BV1xx411c7mD'), /取消/)
        assert.equal(calls, 0)
    } finally { await f.close() }
})
