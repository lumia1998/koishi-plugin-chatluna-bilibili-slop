import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from 'koishi'
import { defaultSettings, type Settings } from '../src/settings.js'
import { shanghaiNow, startPush } from '../src/push.js'
import { Store } from '../src/store.js'

function fixture(patch: Partial<Settings> = {}) {
    const dirs: string[] = []
    const intervalFns: (() => void)[] = []
    const ctx = {
        setInterval: (fn: () => void) => { intervalFns.push(fn); return () => {} },
        logger: () => ({ info: () => {}, warn: () => {} }),
    } as unknown as Context
    const settings = { ...defaultSettings(), ...patch }
    const logger = { info: () => {}, warn: () => {} }
    const intervalMs: number[] = []
    const ctxWithMs = {
        ...ctx,
        setInterval: (fn: () => void, ms: number) => { intervalFns.push(fn); intervalMs.push(ms); return () => {} },
    } as unknown as Context
    return {
        dirs, intervalFns, intervalMs, ctx: ctxWithMs, settings, logger,
        async store() {
            const dir = await mkdtemp(join(tmpdir(), 'bili-push-'))
            dirs.push(dir)
            const store = new Store(dir)
            await store.init()
            return store
        },
        clean: () => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))),
    }
}

test('pushTimes 为空时不安装定时器', async () => {
    const f = fixture({ pushTimes: [] })
    try {
        const store = await f.store()
        startPush(f.ctx, f.settings, store, () => ({}) as never, f.logger, async () => {})
        assert.equal(f.intervalFns.length, 0)
    } finally { await f.clean() }
})

test('非法时刻被过滤，一个合法时刻都没有时也不装定时器', async () => {
    const f = fixture({ pushTimes: ['25:00', 'abc', ''] })
    try {
        const store = await f.store()
        startPush(f.ctx, f.settings, store, () => ({}) as never, f.logger, async () => {})
        assert.equal(f.intervalFns.length, 0)
    } finally { await f.clean() }
})

test('到点只跑一次：同一分钟重复 tick 不重复触发，槽位落盘', async () => {
    const now = shanghaiNow()
    const f = fixture({ pushTimes: [now.time] })
    try {
        const store = await f.store()
        let runs = 0
        startPush(f.ctx, f.settings, store, () => ({}) as never, f.logger, async () => { runs++ })
        assert.equal(f.intervalFns.length, 1)
        assert.equal(f.intervalMs[0], 60_000)

        f.intervalFns[0]()
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.equal(runs, 1)

        f.intervalFns[0]()
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.equal(runs, 1, '同一时刻不应重复触发')

        const key = Object.keys(store.state.pushSlots)[0]
        assert.equal(key, `${now.day} ${now.time}`)
    } finally { await f.clean() }
})

test('未到点不触发', async () => {
    const now = shanghaiNow()
    const other = now.time === '03:07' ? '04:07' : '03:07'
    const f = fixture({ pushTimes: [other] })
    try {
        const store = await f.store()
        let runs = 0
        startPush(f.ctx, f.settings, store, () => ({}) as never, f.logger, async () => { runs++ })
        f.intervalFns[0]()
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.equal(runs, 0)
        assert.equal(Object.keys(store.state.pushSlots).length, 0)
    } finally { await f.clean() }
})

test('上一轮没跑完时本次 tick 让开，不叠进程', async () => {
    const now = shanghaiNow()
    const f = fixture({ pushTimes: [now.time] })
    try {
        const store = await f.store()
        let runs = 0
        let release: () => void = () => {}
        startPush(f.ctx, f.settings, store, () => ({}) as never, f.logger,
            () => new Promise<void>((resolve) => { runs++; release = resolve }))
        f.intervalFns[0]()
        assert.equal(runs, 1)
        f.intervalFns[0]()
        assert.equal(runs, 1, '正在跑时不叠加')
        release()
        await new Promise((resolve) => setTimeout(resolve, 20))
    } finally { await f.clean() }
})

test('run() 抛错时只记日志，不把定时器打挂', async () => {
    const now = shanghaiNow()
    const f = fixture({ pushTimes: [now.time] })
    try {
        const store = await f.store()
        const warnings: string[] = []
        startPush(f.ctx, f.settings, store, () => ({}) as never,
            { info: () => {}, warn: (format: string, ...args: unknown[]) => warnings.push(`${format} ${args.join(' ')}`) },
            async () => { throw new Error('boom') })
        f.intervalFns[0]()
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.ok(warnings.some((msg) => msg.includes('boom')))
    } finally { await f.clean() }
})
