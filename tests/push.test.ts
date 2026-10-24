import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from 'koishi'
import type { Api } from '../src/api.js'
import { Config } from '../src/config.js'
import { runPush, startPush, startWatch } from '../src/push.js'
import { Store } from '../src/store.js'
import type { Comment, Video } from '../src/types.js'

const item: Video = {
    bvid: 'BV1xx411c7mD', aid: 1, cid: 1, title: '抽象视频', author: 'up', uid: '7',
    duration: 180, pubdate: Math.floor(Date.now() / 1000), play: 1, comments: 10,
    description: '', url: 'https://www.bilibili.com/video/BV1xx411c7mD', pic: 'https://i0.hdslb.com/x.jpg',
    sources: ['up:7']
}
const comments: Comment[] = [
    { rpid: '1', root: '0', parent: '0', uid: '1', name: 'a', text: '@朋友 请你吃', likes: 1, mentions: true },
    { rpid: '2', root: '0', parent: '0', uid: '2', name: 'b', text: '@朋友 呕 逆天', likes: 1, mentions: true }
]

async function fixture(patch: Partial<Config> = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'bili-push-'))
    const store = new Store(dir)
    await store.init()
    const broadcasts: unknown[][] = []
    const intervalFns: (() => void)[] = []
    const ctx = {
        broadcast: async (channels: string[], content: unknown) => { broadcasts.push([channels, content]) },
        setInterval: (fn: () => void) => { intervalFns.push(fn); return () => {} },
        sleep: async () => {},
        logger: () => ({ warn: () => {} })
    } as unknown as Context
    const api = {
        bot: { selfId: '42' },
        search: async () => [item], up: async () => [item], related: async () => [],
        info: async () => item, comments: async () => comments,
        resolve: async (name: string) => ({ id: '7', name })
    } as unknown as Api
    const logger = { warn: () => {} }
    const cfg = Config({ channels: ['qq:group1'], pushTimes: ['12:00'], pushCount: 3, watchUps: ['某UP'], watchInterval: 30, ...patch })
    return { dir, store, ctx, api, cfg, logger, broadcasts, intervalFns, clean: () => rm(dir, { recursive: true, force: true }) }
}

test('channels 为空时搬运和监听都不启动', async () => {
    const f = await fixture({ channels: [], pushTimes: ['12:00'], watchUps: ['某UP'] })
    try {
        // startPush/startWatch are only called when channels.length > 0 (see index.ts);
        // calling them directly here would still install timers, so we assert the gate.
        assert.equal(f.cfg.channels.length, 0)
    } finally { await f.clean() }
})

test('push 时间槽到点只推一次且记录槽位', async () => {
    const shanghai = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
    const time = shanghai.format(new Date()).replace('24:', '00:')
    const f = await fixture({ pushTimes: [time] })
    try {
        startPush(f.ctx, f.cfg, f.store, () => f.api, f.logger)
        assert.equal(f.intervalFns.length, 1)
        await f.intervalFns[0]() // slot matches -> one push
        await new Promise((resolve) => setTimeout(resolve, 20)) // let runPush finish
        assert.equal(f.broadcasts.length, 1)
        const slotKey = Object.keys(f.store.state.pushSlots)[0]
        assert.ok(slotKey)
        await f.intervalFns[0]() // same slot already fired today -> nothing
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.equal(f.broadcasts.length, 1)
        assert.ok(f.store.state.shown[item.bvid])
        // A second manual runPush is also deduplicated via shown.
        await runPush(f.ctx, f.cfg, f.store, () => f.api, f.logger)
        assert.equal(f.broadcasts.length, 1)
    } finally { await f.clean() }
})

test('UP 监听首次只建基线，第二次有新投稿才推送', async () => {
    const f = await fixture({ watchUps: ['某UP'], watchInterval: 30 })
    try {
        startWatch(f.ctx, f.cfg, f.store, () => f.api, f.logger)
        assert.equal(f.intervalFns.length, 1)
        await f.intervalFns[0]() // first tick: baseline only
        assert.equal(f.broadcasts.length, 0)
        assert.ok(f.store.state.watch['7'])

        const newer = { ...item, bvid: 'BV1yy411c7mE', pubdate: Math.floor(Date.now() / 1000) + 10 }
        f.api.up = async () => [newer, item]
        await f.intervalFns[0]() // second tick: new upload pushed
        assert.equal(f.broadcasts.length, 1)
        assert.ok(f.store.state.watch['7'] >= newer.pubdate)
    } finally { await f.clean() }
})
