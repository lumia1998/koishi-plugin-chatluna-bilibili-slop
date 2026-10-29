import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from 'koishi'
import { Api } from '../src/api.js'
import { apply } from '../src/index.js'
import { duration, parallel, rank } from '../src/score.js'
import { Service } from '../src/service.js'
import { defaultSettings, type Settings } from '../src/settings.js'
import { migrate, Store } from '../src/store.js'
import type { Comment, InboxItem, ShuttleRecord, Video } from '../src/types.js'

const BV = 'BV1xx411c7mD'

const item: Video = {
    bvid: BV, aid: 12345, cid: 67890, title: '抽象TV第3期', author: 'test', uid: '77',
    duration: 180, pubdate: Math.floor(Date.now() / 1000), play: 1000, comments: 100,
    description: '简介', url: `https://www.bilibili.com/video/${BV}`, sources: ['up:77'],
}
const comments: Comment[] = [
    { rpid: '1', root: '0', parent: '0', uid: '1', name: 'a', text: '@朋友', likes: 10, mentions: true },
    { rpid: '2', root: '0', parent: '0', uid: '2', name: 'b', text: '@朋友 请你吃 逆天', likes: 8, mentions: true },
]

async function fixture(patch: Partial<Settings> = {},
    recognize?: (api: Api, bvid: string) => Promise<string>) {
    const dir = await mkdtemp(join(tmpdir(), 'bili-slop-'))
    const cfg: Settings = { ...defaultSettings(), ...patch }
    const store = new Store(dir)
    await store.init()
    const calls = {
        comment: 0, reply: 0, dm: 0, asr: 0, subtitle: 0, summary: 0, audio: 0,
        favorite: 0, unfavorite: 0,
    }
    const api = {
        bot: { selfId: '42', getUser: async (id: string) => ({ id, name: '主人' }), session: () => ({}) },
        info: async () => item,
        comments: async () => comments,
        stats: async () => ({ like: 9, coin: 3, favorite: 4, share: 1, danmaku: 12 }),
        danmaku: async () => [{ time: 12, text: '前方高能' }],
        subtitle: async () => { calls.subtitle++; return '字幕原文' },
        summary: async () => { calls.summary++; return { summary: 'AI 总结', outline: [] } },
        audio: async () => { calls.audio++; return { data: Buffer.from('x'), mime: 'audio/mp4' } },
        search: async () => [item],
        searchUsers: async () => [{ mid: 99, uname: '朋友', usign: '', fans: 1, videos: 0, level: 1 }],
        up: async () => [item],
        related: async () => [],
        resolve: async (name: string) => /^\d+$/.test(name) ? { id: name, name: '用户' + name } : { id: '99', name },
        userInfo: async () => ({ name: '朋友', sign: '签名', fans: 10, level: 4 }),
        userStat: async () => ({ fans: 10, following: 3, videos: 88 }),
        isFollowing: async () => false,
        follow: async () => true,
        sendComment: async () => { calls.comment++; return '317732441345' },
        reply: async () => { calls.reply++; return '9007199254740993' },
        dm: async () => { calls.dm++; return ['555'] },
        messages: async () => ({
            data: [{ id: 'm1', user: { id: '99', name: '朋友' }, content: 'hi', timestamp: 1 }],
        }),
        inbox: async (): Promise<InboxItem[]> => [
            { id: 'r1', kind: 'reply', fromUid: '5', fromName: '路人', bvid: BV, rpid: '88', text: '回复你', at: Date.now(), scope: 'video' },
            { id: 'r2', kind: 'reply', fromUid: '6', fromName: '楼里', bvid: BV, rpid: '89', text: '楼中楼', at: Date.now(), scope: 'thread' },
            { id: 'a1', kind: 'at', fromUid: '7', fromName: '喊你', bvid: BV, text: '@主人 看这个', at: Date.now() },
        ],
        favoriteFolders: async () => [{ id: 1, title: '默认收藏夹', media_count: 0 }],
        favorite: async () => { calls.favorite++; return true },
        unfavorite: async () => { calls.unfavorite++; return true },
        inFavorite: async () => calls.unfavorite === 0,
        visible: async () => 'public',
    } as unknown as Api
    const recognizeFn = recognize
        ? async (api: Api, bvid: string) => { calls.asr++; return recognize(api, bvid) }
        : undefined
    const service = new Service(cfg, store, recognizeFn)
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
        peak = Math.max(peak, active + 1)
        active++
        await new Promise((resolve) => setTimeout(resolve, 3))
        active--
        return value * 2
    })
    assert.equal(peak, 2)
    assert.deepEqual(result, [2, 4, 6, 8, 10, 12])
})

test('看视频：字幕优先，带统计与弹幕；无字幕降级 ASR 并命中缓存；再降级 AI 总结', async () => {
    const f = await fixture({ transcribe: true, preferSubtitle: true }, async () => '转写文本')
    try {
        const first = await f.service.video(f.api, item.bvid)
        assert.equal(first.contentSource, 'subtitle')
        assert.equal(first.content, '字幕原文')
        assert.equal(first.summary, 'AI 总结')
        assert.equal(f.calls.asr, 0)
        assert.deepEqual(first.stats, { like: 9, coin: 3, favorite: 4, share: 1, danmaku: 12 })
        assert.deepEqual(first.danmaku, [{ time: 12, text: '前方高能' }])

        // 无字幕 → ASR，第二次走缓存
        f.api.subtitle = async () => ''
        const second = await f.service.video(f.api, 'BV1yy411c7mE')
        assert.equal(second.contentSource, 'asr')
        assert.equal(second.content, '转写文本')
        assert.equal(f.calls.asr, 1)
        const third = await f.service.video(f.api, 'BV1yy411c7mE')
        assert.equal(third.contentSource, 'asr')
        assert.equal(f.calls.asr, 1, '第二次应命中转写缓存')
    } finally { await f.clean() }

    // transcribe 关闭 → 直接落到 AI 总结
    const g = await fixture({ transcribe: false, preferSubtitle: true })
    try {
        g.api.subtitle = async () => ''
        const viaSummary = await g.service.video(g.api, BV)
        assert.equal(viaSummary.contentSource, 'summary')
        assert.equal(viaSummary.content, 'AI 总结')
        assert.equal(g.calls.asr, 0)
    } finally { await g.clean() }

    // preferSubtitle 关闭时不读字幕
    const h = await fixture({ preferSubtitle: false, transcribe: false })
    try {
        const skipped = await h.service.video(h.api, BV)
        assert.equal(h.calls.subtitle, 0)
        assert.equal(skipped.contentSource, 'summary')
    } finally { await h.clean() }
})

test('看视频：长字幕按 offset 分页，最后一页不再标 truncated', async () => {
    const f = await fixture()
    try {
        f.api.subtitle = async () => '字'.repeat(30000)
        const page1 = await f.service.video(f.api, BV)
        assert.equal(page1.truncated, true)
        assert.equal(page1.content.length, 12000)
        const page2 = await f.service.video(f.api, BV, page1.nextOffset)
        assert.equal(page2.content.length, 12000)
        const page3 = await f.service.video(f.api, BV, page2.nextOffset!)
        assert.equal(page3.content.length, 6000)
        assert.equal(page3.truncated, undefined)
    } finally { await f.clean() }
})

test('搬视频：reason 必填；指定单条可跳过召回；7 天内不重搬；delivery 回写台账', async () => {
    const f = await fixture({ ownerUid: '99' })
    try {
        await assert.rejects(f.service.shuttle(f.api, {}), /理由/)

        const seen: ShuttleRecord[][] = []
        const result = await f.service.shuttle(f.api, {
            bvid: BV, reason: '这个抽象到离谱', limit: 1,
            deliver: async (records) => { seen.push(records); return ['group'] },
        })
        assert.equal(result.picks.length, 1)
        assert.equal(result.picks[0].reason, '这个抽象到离谱')
        assert.equal(result.picks[0].atRatio, 1)
        assert.deepEqual(result.delivered, ['group'])
        assert.equal(seen[0][0].bvid, BV)
        assert.ok(f.store.state.shuttles[BV], '搬运记录应落库')
        assert.deepEqual(seen[0][0].delivery, ['group'], '交付通道应回写')

        const again = await f.service.shuttle(f.api, { bvid: BV, reason: '再搬一次' })
        assert.equal(again.picks.length, 0)
        assert.ok(again.errors.some((e) => e.includes('已经搬过')))

        const forced = await f.service.shuttle(f.api, { bvid: BV, reason: '硬要再搬', includeShown: true })
        assert.equal(forced.picks.length, 1)
    } finally { await f.clean() }
})

test('搬视频：分区过滤按 tname 生效，记录带上播放与评论数', async () => {
    const f = await fixture({ videoTypes: ['搞笑'] })
    try {
        // 没有 tname 时放行，避免误杀
        const latched = await f.service.shuttle(f.api, { bvid: BV, reason: '没有分区信息也放行' })
        assert.equal(latched.picks.length, 1)
        assert.equal(latched.picks[0].play, 1000)
        assert.equal(latched.picks[0].comments, 100)
    } finally { await f.clean() }

    const g = await fixture({ videoTypes: ['搞笑'] })
    try {
        g.api.info = async () => ({ ...item, tname: '美食' })
        const rejected = await g.service.shuttle(g.api, { bvid: BV, reason: '测试' })
        assert.equal(rejected.picks.length, 0)
        assert.ok(rejected.errors.some((e) => e.includes('美食')), rejected.errors.join('|'))
    } finally { await g.clean() }

    const h = await fixture({ videoTypes: ['搞笑'] })
    try {
        h.api.info = async () => ({ ...item, tname: '搞笑' })
        const passed = await h.service.shuttle(h.api, { bvid: BV, reason: '测试' })
        assert.equal(passed.picks.length, 1)
    } finally { await h.clean() }
})

test('搬视频：偏好过滤命中屏蔽词与时长下限时丢弃，并说明原因', async () => {
    const f = await fixture({ blockKeywords: ['吃播'], minDuration: 600 })
    try {
        const blocked = await f.service.shuttle(f.api, { bvid: BV, reason: '测试' })
        assert.equal(blocked.picks.length, 0)
        assert.ok(blocked.errors.some((e) => e.includes('吃播') || e.includes('低于')), blocked.errors.join('|'))

        const f2 = await fixture({ minDuration: 600 })
        try {
            const tooShort = await f2.service.shuttle(f2.api, { bvid: BV, reason: '测试' })
            assert.equal(tooShort.picks.length, 0)
            assert.ok(tooShort.errors.some((e) => e.includes('低于 600s')))
        } finally { await f2.clean() }
    } finally { await f.clean() }
})

test('信息回复：按 kind 读取私信/评论/楼中楼/@，合并读取按时间倒序', async () => {
    const f = await fixture({ ownerUid: '99' })
    try {
        const dm = await f.service.inbox(f.api, { action: 'read', kind: 'dm' })
        assert.equal(dm.items.length, 1)
        assert.equal(dm.items[0].scope, 'dm')
        assert.equal(dm.items[0].text, 'hi')

        const videoReplies = await f.service.inbox(f.api, { action: 'read', kind: 'comment' })
        assert.deepEqual(videoReplies.items.map((i) => i.rpid), ['88'])

        const thread = await f.service.inbox(f.api, { action: 'read', kind: 'thread' })
        assert.deepEqual(thread.items.map((i) => i.rpid), ['89'])

        const at = await f.service.inbox(f.api, { action: 'read', kind: 'at' })
        assert.equal(at.items[0].kind, 'at')

        const all = await f.service.inbox(f.api, { action: 'read' })
        assert.equal(all.items.length, 4)
        for (let i = 1; i < all.items.length; i++) {
            assert.ok(all.items[i - 1].at >= all.items[i].at, '合并结果应按时间倒序')
        }
    } finally { await f.clean() }
})

test('信息回复：开关关闭时回复被拒并给出原因，不触碰网络', async () => {
    const f = await fixture({ ownerUid: '99' })
    try {
        const off = await f.service.inbox(f.api, { action: 'reply', kind: 'comment', video: BV, text: '你好' })
        assert.equal(off.replied?.[0].ok, false)
        assert.match(off.replied![0].error!, /allowComment/)
        assert.equal(f.calls.comment, 0)

        await assert.rejects(
            f.service.inbox(f.api, { action: 'reply', kind: 'thread', video: BV, text: '你好' }),
            /target/)
    } finally { await f.clean() }
})

test('信息回复：开关打开后楼中楼回复走 sendComment 并记账', async () => {
    const f = await fixture({ ownerUid: '99', allowReplySub: true, allowReplyRoot: true })
    try {
        const result = await f.service.inbox(f.api, {
            action: 'reply', kind: 'thread', video: BV, target: '777', root: '111', text: '回你一句',
        })
        assert.equal(result.replied?.[0].ok, true)
        assert.equal(f.calls.reply, 1)
        const record = Object.values(f.store.state.comments)[0]
        assert.equal(record.state, 'sent')
        assert.equal(record.root, '111')
        assert.equal(record.parent, '777')

        // 同一楼层不重发
        const again = await f.service.inbox(f.api, {
            action: 'reply', kind: 'thread', video: BV, target: '777', root: '111', text: '再说一遍',
        })
        assert.equal(again.replied?.[0].ok, false)
        assert.equal(f.calls.reply, 1)
    } finally { await f.clean() }
})

test('视频管理：list 收藏夹、add 收藏并复核、remove 取消收藏并复核', async () => {
    const f = await fixture({ favFolderId: 0 })
    try {
        const list = await f.service.manage(f.api, 'list')
        assert.deepEqual(list, { ok: true, folders: [{ id: 1, title: '默认收藏夹', media_count: 0 }] })

        const noFolder = await f.service.manage(f.api, 'add', { video: BV })
        assert.equal(noFolder.ok, false)
        assert.match(String((noFolder as { error?: string }).error), /收藏夹/)
        await assert.rejects(f.service.manage(f.api, 'add', {}), /需要一个视频/)

        const added = await f.service.manage(f.api, 'add', { video: BV, folderId: 1 })
        assert.equal(added.ok, true)
        assert.equal((added as { favorite?: boolean }).favorite, true)
        assert.equal(f.calls.favorite, 1)

        const removed = await f.service.manage(f.api, 'remove', { video: BV, folderId: 1 })
        assert.equal(removed.ok, true)
        assert.equal((removed as { removed?: boolean }).removed, true, '取消后复核应显示已不在收藏夹')
        assert.equal(f.calls.unfavorite, 1)
    } finally { await f.clean() }
})

test('视频管理：没配默认收藏夹时用 favFolderId 兜底', async () => {
    const f = await fixture({ favFolderId: 7 })
    try {
        const added = await f.service.manage(f.api, 'add', { video: BV })
        assert.equal((added as { folderId?: number }).folderId, 7)
    } finally { await f.clean() }
})

test('发评论：正文禁止 @、atOwner 注入、同视频去重、未知结果永不重放', async () => {
    const f = await fixture({ allowComment: true, ownerUid: '99' })
    try {
        await assert.rejects(f.service.comment(f.api, BV, '你好 @某人', {}), /不能包含 @/)
        const sent = await f.service.comment(f.api, BV, '这期值得看', { atOwner: true })
        assert.equal(sent.rpid, '317732441345')
        assert.match(sent.text, /^@主人 这期值得看$/)
        await assert.rejects(f.service.comment(f.api, BV, '再来一条', {}), /已经.*评论|待确认/)
    } finally { await f.clean() }

    const g = await fixture({ allowComment: true })
    try {
        g.api.sendComment = async () => { g.calls.comment++; throw new Error('连接中断') }
        await assert.rejects(g.service.comment(g.api, BV, '测试', {}), /结果未知/)
        assert.equal(g.calls.comment, 1)
        assert.equal(Object.values(g.store.state.comments)[0].state, 'unknown')
        await assert.rejects(g.service.comment(g.api, BV, '重试', {}), /待确认/)
        assert.equal(g.calls.comment, 1, '结果未知的评论不得重放')
    } finally { await g.clean() }
})

test('全局限速：超过 commentPerHour 的评论被拒', async () => {
    const f = await fixture({ allowComment: true, commentPerHour: 1 })
    try {
        await f.service.comment(f.api, BV, '第一条', {})
        await assert.rejects(
            f.service.comment(f.api, 'BV1yy411c7mE', '第二条', {}),
            /全局限速/)
    } finally { await f.clean() }
})

test('台账迁移：v1 → v4（seen 转 shown）、v2 / v3 → v4（补 shuttles / views）、损坏仍拒绝', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-migrate-'))
    try {
        const legacy = {
            version: 1,
            comments: { '42:BV1xx411c7mD': { account: '42', bvid: BV, at: '2024-01-01', text: 'hi', state: 'sent' } },
            seen: { '42:scope:BV1xx411c7mD': 'run-1' },
            runs: { abc: {} },
        }
        await writeFile(join(dir, 'state.json'), JSON.stringify(legacy))
        const store = new Store(dir)
        await store.init()
        assert.equal(store.state.version, 4)
        assert.equal(store.state.comments['42:BV1xx411c7mD'].text, 'hi')
        assert.ok(store.state.shown[BV])
        assert.deepEqual(store.state.shuttles, {})
        assert.deepEqual(store.state.views, {})
        assert.equal('runs' in store.state, false)

        const v2 = {
            version: 2, comments: {}, transcripts: {}, shown: { [BV]: 1 }, watch: {},
        }
        await writeFile(join(dir, 'state.json'), JSON.stringify(v2))
        const fromV2 = new Store(dir)
        await fromV2.init()
        assert.equal(fromV2.state.version, 4)
        assert.deepEqual(fromV2.state.shuttles, {})
        assert.deepEqual(fromV2.state.views, {})

        // v3 → v4：只补观看历史表，搬运记录原样保留
        const v3 = {
            version: 3, comments: {}, transcripts: {}, shown: {}, watch: {},
            shuttles: { [BV]: { bvid: BV, at: '2024-01-01T00:00:00+08:00' } },
        }
        await writeFile(join(dir, 'state.json'), JSON.stringify(v3))
        const fromV3 = new Store(dir)
        await fromV3.init()
        assert.equal(fromV3.state.version, 4)
        assert.deepEqual(fromV3.state.views, {})
        assert.ok(fromV3.state.shuttles[BV])

        await writeFile(join(dir, 'state.json'), '{bad json')
        await assert.rejects(new Store(dir).init())

        // 缺字段视为损坏，不静默补
        await writeFile(join(dir, 'state.json'), JSON.stringify({ version: 4, comments: {} }))
        assert.throws(() => migrate({ version: 4, comments: {} } as never), /损坏/)
    } finally { await rm(dir, { recursive: true, force: true }) }
})

function mockCtx(dir: string) {
    const tools = new Map<string, { createTool: () => { invoke: Function } }>()
    const readyFns: (() => void)[] = []
    const listeners = new Map<string, Function>()
    const cmd = { action: () => cmd }
    const ctx = {
        baseDir: dir, bots: [],
        on: (event: string, fn: () => void) => { if (event === 'ready') readyFns.push(fn) },
        effect: (fn: () => void) => fn(),
        command: () => cmd,
        logger: () => ({ info: () => {}, warn: () => {} }),
        chatluna: {
            platform: {
                registerTool: (name: string, spec: { createTool: () => { invoke: Function } }) => {
                    tools.set(name, spec)
                    return () => {}
                },
            },
        },
        broadcast: async () => {},
        setTimeout: () => () => {},
        setInterval: () => () => {},
        sleep: async () => {},
        scope: { isActive: true },
        console: {
            addEntry: () => {},
            addListener: (type: string, fn: Function) => { listeners.set(type, fn) },
        },
        inject: (_deps: string[], cb: (c: unknown) => void) => cb(ctx),
    } as unknown as Context
    return {
        ctx, tools, listeners,
        ready: () => readyFns.forEach((fn) => fn()),
    }
}

const DEFAULT_TOOLS = [
    'bili_inbox', 'bili_manage', 'bili_search', 'bili_shuttle',
    'bili_status', 'bili_subscribe', 'bili_user', 'bili_video',
]

test('插件加载：原生配置页为空；注册 8 个工具并挂上控制台 RPC', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-plugin-'))
    const { ctx, tools, listeners, ready } = mockCtx(dir)
    try {
        await apply(ctx, {} as never)
        ready()
        assert.deepEqual([...tools.keys()].sort(), DEFAULT_TOOLS)

        for (const event of [
            'bili-slop/settings', 'bili-slop/settings/update', 'bili-slop/status',
            'bili-slop/login/start', 'bili-slop/login/poll', 'bili-slop/shuttle',
            'bili-slop/verify', 'bili-slop/summary', 'bili-slop/reports',
            'bili-slop/models', 'bili-slop/summary/generate',
        ]) {
            assert.ok(listeners.has(event), `缺少 RPC ${event}`)
        }
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('插件加载：低权限被拒', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-tools-'))
    const { ctx, tools, ready } = mockCtx(dir)
    try {
        await apply(ctx, {} as never)
        ready()
        const denied = await tools.get('bili_status')!.createTool().invoke({}, {
            configurable: {
                session: {
                    platform: 'test', userId: 'guest',
                    observeUser: async () => ({ authority: 0 }),
                },
            },
        })
        assert.equal(JSON.parse(denied).ok, false)
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('插件加载：bili_inbox 常驻注册，控制台改开关后描述立刻变', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-inbox-tool-'))
    const { ctx, tools, listeners, ready } = mockCtx(dir)
    try {
        await apply(ctx, {} as never)
        ready()
        assert.ok(tools.has('bili_inbox'), '信息回复应该常驻，读取消息不受开关限制')

        const describe = () => String((tools.get('bili_inbox') as unknown as { description: string }).description)
        assert.match(describe(), /一级评论=关/)

        // 走真实 RPC：面板里点开关就是这条路径
        await listeners.get('bili-slop/settings/update')!({ allowReplyRoot: true })

        assert.match(describe(), /回复楼层=开/, '改完开关不用重载就该生效')
    } finally { await rm(dir, { recursive: true, force: true }) }
})
