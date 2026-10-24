import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from 'koishi'
import { Api } from '../src/api.js'
import { Config } from '../src/config.js'
import { apply } from '../src/index.js'
import { Service } from '../src/service.js'
import { migrate, Store } from '../src/store.js'
import { duration, parallel, rank } from '../src/score.js'
import type { Comment, Video } from '../src/types.js'

const item: Video = {
    bvid: 'BV1xx411c7mD', aid: 12345, cid: 67890, title: '抽象TV第3期', author: 'test', uid: '77',
    duration: 180, pubdate: Math.floor(Date.now() / 1000), play: 1000, comments: 100,
    description: '', url: 'https://www.bilibili.com/video/BV1xx411c7mD', sources: ['up:77']
}
const comments: Comment[] = [
    { rpid: '1', root: '0', parent: '0', uid: '1', name: 'a', text: '@朋友', likes: 10, mentions: true },
    { rpid: '2', root: '0', parent: '0', uid: '2', name: 'b', text: '@朋友 请你吃 逆天', likes: 8, mentions: true }
]

async function fixture(patch: Partial<Config> = {}, recognize?: (api: Api, bvid: string) => Promise<string>) {
    const dir = await mkdtemp(join(tmpdir(), 'bili-slop-'))
    const cfg = Config({ keywords: ['test'], ...patch })
    const store = new Store(dir)
    await store.init()
    const calls = { comment: 0, reply: 0, dm: 0, audio: 0, subtitle: 0, summary: 0, asr: 0 }
    const api = {
        bot: { selfId: '42', getUser: async (id: string) => ({ id, name: '主人' }), session: () => ({}) },
        info: async () => item,
        comments: async () => comments,
        subtitle: async () => { calls.subtitle++; return '字幕原文' },
        summary: async () => { calls.summary++; return { summary: 'AI 总结', outline: [] } },
        audio: async () => { calls.audio++; return { data: Buffer.from('x'), mime: 'audio/mp4' } },
        search: async () => [item],
        searchUsers: async () => [{ mid: 99, uname: '朋友', usign: '', fans: 1, videos: 0, level: 1 }],
        up: async () => [item],
        related: async () => [],
        resolve: async (name: string) => /^\d+$/.test(name) ? { id: name, name: '用户' + name } : { id: '99', name },
        userInfo: async () => ({ name: '朋友', sign: '签名', fans: 10, level: 4 }),
        isFollowing: async () => false,
        follow: async () => true,
        sendComment: async () => { calls.comment++; return '317732441345' },
        reply: async () => { calls.reply++; return '317732441346' },
        dm: async () => { calls.dm++; return ['555'] },
        messages: async () => ({ data: [{ id: 'm1', user: { id: '99', name: '朋友' }, content: 'hi', timestamp: 1 }] }),
        visible: async () => 'public'
    } as unknown as Api
    const wrapped = recognize ? async (api: Api, bvid: string) => { calls.asr++; return recognize(api, bvid) } : undefined
    const service = new Service(cfg, store, wrapped)
    return { cfg, store, service, api, calls, clean: () => rm(dir, { recursive: true, force: true }) }
}

test('行为评分保留 UP、连载和评论证据，并降低吃播候选得分', () => {
    const result = rank(item, comments)
    const food = rank({ ...item, title: '吃播探店', sources: ['kw:大份'] }, comments)
    assert.equal(result.atRatio, 1)
    assert.equal(result.pureAtRatio, 0.5)
    assert.equal(result.feedRatio, 0.5)
    assert.equal(result.fromUp, true)
    assert.equal(result.series, true)
    assert.deepEqual(result.evidence, comments.map((c) => c.text))
    assert.ok(result.score > food.score + 40)
    assert.equal(duration('1:02:03'), 3723)
    assert.equal(rank(item, []).atRatio, 0)
})

test('并发抓取峰值受限且结果顺序稳定', async () => {
    let active = 0, peak = 0
    const result = await parallel([1, 2, 3, 4, 5, 6], 2, async (value) => {
        peak = Math.max(peak, ++active)
        await new Promise((resolve) => setTimeout(resolve, 3))
        active--
        return value * 2
    })
    assert.equal(peak, 2)
    assert.deepEqual(result, [2, 4, 6, 8, 10, 12])
})

test('bili_video 字幕优先；无字幕+transcribe 走 ASR 且命中缓存；offset 分页', async () => {
    const f = await fixture({ transcribe: true }, async () => '转写文本')
    try {
        // subtitle present -> subtitle source, no ASR
        const first = await f.service.video(f.api, item.bvid)
        assert.equal(first.contentSource, 'subtitle')
        assert.equal(first.content, '字幕原文')
        assert.equal(first.summary, 'AI 总结')
        assert.equal(f.calls.audio, 0)

        // no subtitle -> ASR, cached afterwards
        f.api.subtitle = async () => ''
        const second = await f.service.video(f.api, 'BV1yy411c7mE')
        assert.equal(second.contentSource, 'asr')
        assert.equal(second.content, '转写文本')
        assert.equal(f.calls.asr, 1)
        const third = await f.service.video(f.api, 'BV1yy411c7mE')
        assert.equal(third.contentSource, 'asr')
        assert.equal(f.calls.asr, 1) // cache hit

        // no subtitle + transcribe off -> summary fallback
        const g = await fixture()
        g.api.subtitle = async () => ''
        const viaSummary = await g.service.video(g.api, item.bvid)
        assert.equal(viaSummary.contentSource, 'summary')
        assert.equal(viaSummary.content, 'AI 总结')
        assert.equal(g.calls.asr, 0)
        await g.clean()

        // pagination
        const long = await fixture()
        const big = '字'.repeat(30000)
        long.api.subtitle = async () => big
        const page1 = await long.service.video(long.api, item.bvid)
        assert.equal(page1.truncated, true)
        assert.equal(page1.content.length, 12000)
        const page2 = await long.service.video(long.api, item.bvid, page1.nextOffset)
        assert.equal(page2.content.length, 12000)
        const page3 = await long.service.video(long.api, item.bvid, page2.nextOffset!)
        assert.equal(page3.content.length, 6000)
        assert.equal(page3.truncated, undefined)
        await long.clean()
    } finally { await f.clean() }
})

test('bili_comment 规则：@ 被拒、atOwner 注入、同视频去重、未知结果不重放', async () => {
    const f = await fixture({ allowComment: true, ownerUid: '99' })
    try {
        await assert.rejects(f.service.comment(f.api, item.bvid, '你好 @某人', {}), /不能包含 @/)
        const sent = await f.service.comment(f.api, item.bvid, '这期值得看', { atOwner: true })
        assert.equal(sent.rpid, '317732441345')
        assert.match(sent.text, /^@主人 这期值得看$/)
        await assert.rejects(f.service.comment(f.api, item.bvid, '再来一条', {}), /已.*评论/)

        // reply path
        const reply = await f.service.comment(f.api, 'BV1yy411c7mE', '回复你', { replyTo: '777', root: '111' })
        assert.equal(reply.rpid, '317732441346')
        assert.equal(f.calls.reply, 1)
        await assert.rejects(f.service.comment(f.api, 'BV1yy411c7mE', '再回复', { replyTo: '777' }), /已经回复过/)

        // unknown result is kept, not replayed
        const g = await fixture({ allowComment: true })
        g.api.sendComment = async () => { g.calls.comment++; throw new Error('连接中断') }
        await assert.rejects(g.service.comment(g.api, item.bvid, '测试', {}), /结果未知/)
        assert.equal(g.calls.comment, 1)
        const record = Object.values(g.store.state.comments)[0]
        assert.equal(record.state, 'unknown')
        await assert.rejects(g.service.comment(g.api, item.bvid, '重试', {}), /已.*评论|待确认/)
        assert.equal(g.calls.comment, 1)
        await g.clean()
    } finally { await f.clean() }
})

test('bili_dm 白名单外收件人被拒；图片与文字组合发送；allowDm=false 拒绝 send', async () => {
    const f = await fixture({ allowDm: true, ownerUid: '99', dmWhitelist: ['100'] })
    try {
        const sent = await f.service.dmSend(f.api, '100', '看图', 'https://example.com/a.png')
        assert.deepEqual(sent.messageIds, ['555'])
        assert.equal(f.calls.dm, 1)
        await assert.rejects(f.service.dmSend(f.api, '12345', 'hi'), /白名单/)
        // default recipient is the owner
        await f.service.dmSend(f.api, undefined, '主人好')
        assert.equal(f.calls.dm, 2)

        const off = await fixture({ allowDm: false, ownerUid: '99' })
        await assert.rejects(off.service.dmSend(off.api, undefined, 'hi'), /未开启/)
        const list = await off.service.dmRead(off.api)
        assert.equal(list[0].content, 'hi')
        await off.clean()
    } finally { await f.clean() }
})

test('bili_find_slop 已展示视频默认排除，includeShown 可包含', async () => {
    const f = await fixture()
    try {
        const first = await f.service.findSlop(f.api, { keywords: ['test'], ups: ['up'] })
        assert.equal(first.items.length, 1)
        assert.ok(first.items[0].score > 0)
        const second = await f.service.findSlop(f.api, { keywords: ['test'], ups: ['up'] })
        assert.equal(second.items.length, 0)
        const third = await f.service.findSlop(f.api, { keywords: ['test'], ups: ['up'], includeShown: true })
        assert.equal(third.items.length, 1)
    } finally { await f.clean() }
})

test('v1 台账迁移到 v2：保留 comments，seen 转 shown，损坏仍拒绝', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-migrate-'))
    try {
        const legacy = {
            version: 1,
            comments: { '42:BV1xx411c7mD': { account: '42', bvid: 'BV1xx411c7mD', at: '2024-01-01', text: 'hi', state: 'sent' } },
            seen: { '42:scope:BV1xx411c7mD': 'run-1' },
            runs: { abc: {} }
        }
        await writeFile(join(dir, 'state.json'), JSON.stringify(legacy))
        const store = new Store(dir)
        await store.init()
        assert.equal(store.state.version, 2)
        assert.equal(store.state.comments['42:BV1xx411c7mD'].text, 'hi')
        assert.ok(store.state.shown['BV1xx411c7mD'])
        assert.equal('runs' in store.state, false)

        await writeFile(join(dir, 'state.json'), '{bad json')
        await assert.rejects(new Store(dir).init())
    } finally { await rm(dir, { recursive: true, force: true }) }
})

function mockCtx(dir: string, bots: unknown[], timers?: { timeouts: number[]; intervals: number[] }) {
    const tools = new Map<string, { createTool: () => { invoke: Function } }>()
    const readyFns: (() => void)[] = []
    const broadcasts: { channels: string[]; content: unknown }[] = []
    const cmd = { action: () => cmd }
    const ctx = {
        baseDir: dir, bots,
        on: (event: string, fn: () => void) => { if (event === 'ready') readyFns.push(fn) },
        effect: (fn: () => void) => fn(), command: () => cmd,
        logger: () => ({ warn: () => {} }),
        chatluna: { platform: { registerTool: (name: string, spec: { createTool: () => { invoke: Function } }) => { tools.set(name, spec); return () => {} } } },
        broadcast: async (channels: string[], content: unknown) => { broadcasts.push({ channels, content }) },
        setTimeout: (fn: () => void, ms: number) => { timers?.timeouts.push(ms); return () => {} },
        setInterval: (fn: () => void, ms: number) => { timers?.intervals.push(ms); return () => {} },
        sleep: async () => {},
        scope: { isActive: true }
    } as unknown as Context
    return { ctx, tools, ready: () => readyFns.forEach((fn) => fn()), broadcasts }
}

const fullBot = {
    platform: 'bilibili', selfId: '42',
    getUser: async (id: string) => ({ id, name: '主人' }),
    sendPrivateMessage: async () => ['555'],
    getMessageList: async () => ({ data: [] }),
    internal: {
        searchVideos: async () => [], searchUsers: async () => [], searchUsersByName: async () => [],
        getVideoInfo: async () => null, getVideoSubtitle: async () => ({ text: '' }),
        getVideoComments: async () => [], getUserVideos: async () => [], getRelatedVideos: async () => [],
        createVideoComment: async () => '1', sendComment: async () => '1',
        getCommentVisibility: async () => 'public', getVideoConclusion: async () => null,
        getUserInfo: async () => ({}),
        followUser: async () => true, unfollowUser: async () => true, isFollowing: async () => false,
        getVideoAudio: async () => ({ data: Buffer.from('x') })
    }
}

test('Koishi 加载后按配置注册工具；默认关闭评论/关注；低权限被拒', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-plugin-'))
    const { ctx, tools, ready } = mockCtx(dir, [])
    try {
        await apply(ctx, Config({}))
        ready()
        assert.deepEqual([...tools.keys()].sort(), [
            'bili_comments', 'bili_dm', 'bili_find_slop', 'bili_search', 'bili_status', 'bili_user', 'bili_video'
        ])
        const result = await tools.get('bili_status')!.createTool().invoke({}, {
            configurable: { session: { platform: 'test', userId: 'guest', observeUser: async () => ({ authority: 0 }) } }
        })
        assert.equal(JSON.parse(result).ok, false)
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('allowComment/allowFollow 开启后注册对应工具，发评论可走通', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-tools-'))
    const { ctx, tools, ready } = mockCtx(dir, [fullBot])
    try {
        await apply(ctx, Config({ allowComment: true, allowFollow: true, ownerUid: '99' }))
        ready()
        assert.equal(tools.size, 9)
        assert.ok(tools.has('bili_comment'))
        assert.ok(tools.has('bili_follow'))
    } finally { await rm(dir, { recursive: true, force: true }) }
})
