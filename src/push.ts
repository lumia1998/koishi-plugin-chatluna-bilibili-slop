import { h, type Context, type Fragment } from 'koishi'
import type { Api } from './api.js'
import type { Config } from './config.js'
import { parseUserInput } from './resolve.js'
import { scout } from './scout.js'
import type { Store } from './store.js'
import type { Candidate } from './types.js'

const TIMEZONE = 'Asia/Shanghai'
const UP_STAGGER_MS = 5000
const WATCH_DAYS = 3

function shanghaiNow(): { day: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date())
    const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
    const hour = get('hour') === '24' ? '00' : get('hour')
    return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` }
}

function card(item: Candidate | { bvid: string; title: string; author: string; url: string; pic?: string; duration?: number }, extra?: string): Fragment {
    const lines: h[] = []
    if (item.pic) lines.push(h.image(item.pic))
    const head = `${item.title}\n${item.author} · ${item.url}`
    const detail = extra ?? (item.duration ? `时长 ${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : '')
    lines.push(h.text(detail ? `${head}\n${detail}` : head))
    return lines
}

export function slopCard(item: Candidate): Fragment {
    const rank = item.rank
    const info = rank
        ? `时长 ${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')} · @率 ${rank.atRatio.toFixed(2)} · 得分 ${rank.score}`
        : ''
    const evidence = rank?.evidence[0] ? `\n热评：${rank.evidence[0].replace(/\n/g, ' ')}` : ''
    return card(item, (info + evidence).trim())
}

/**
 * Runs one slop-scout pass and broadcasts up to `count` fresh finds to the
 * configured channels. Videos shown by an earlier push or bili_find_slop call
 * within 7 days are skipped. Every error is logged, never thrown.
 */
export async function runPush(ctx: Context, cfg: Config, store: Store, makeApi: () => Api, logger: { warn: (...args: unknown[]) => void }) {
    try {
        const api = makeApi()
        const now = Date.now()
        const result = await scout(api, cfg.keywords, cfg.ups)
        const fresh = result.items.filter((item) => !store.state.shown[item.bvid] || now - store.state.shown[item.bvid] > 7 * 86400_000)
        const picks = fresh.slice(0, cfg.pushCount)
        if (!picks.length) {
            logger.warn('找屎搬运：本轮没有符合条件的视频')
            return
        }
        for (const item of picks) {
            try { await ctx.broadcast(cfg.channels, slopCard(item)) }
            catch (err) { logger.warn('推送 %s 失败：%s', item.bvid, (err as Error).message) }
        }
        await store.locked(async () => {
            for (const item of picks) store.state.shown[item.bvid] = now
            await store.save()
        })
    } catch (err) {
        logger.warn('找屎搬运失败：%s', (err as Error).message)
    }
}

/**
 * Polls watched UP uploads every cfg.watchInterval minutes. The first run only
 * records the latest pubdate baseline; later runs broadcast new uploads.
 */
export function startWatch(ctx: Context, cfg: Config, store: Store, makeApi: () => Api, logger: { warn: (...args: unknown[]) => void }) {
    const tick = async () => {
        try {
            const api = makeApi()
            for (const [index, name] of cfg.watchUps.entries()) {
                try {
                    const target = parseUserInput(name)
                    const resolved = target.uid
                        ? { id: target.uid, name: name }
                        : await api.resolve(target.name!)
                    const videos = await api.up(resolved.id, WATCH_DAYS)
                    const latest = videos.reduce((max, item) => Math.max(max, item.pubdate || 0), 0)
                    const baseline = store.state.watch[resolved.id]
                    if (baseline === undefined) {
                        await store.locked(async () => {
                            store.state.watch[resolved.id] = latest
                            await store.save()
                        })
                        continue // first run only establishes the baseline
                    }
                    const fresh = videos.filter((item) => (item.pubdate || 0) > baseline)
                    if (latest > baseline) {
                        await store.locked(async () => {
                            store.state.watch[resolved.id] = latest
                            await store.save()
                        })
                    }
                    for (const item of fresh.sort((a, b) => a.pubdate - b.pubdate)) {
                        try {
                            await ctx.broadcast(cfg.channels, card(item, `UP 主 ${resolved.name} 有新投稿`))
                        } catch (err) { logger.warn('推送 UP 新投稿失败：%s', (err as Error).message) }
                    }
                } catch (err) {
                    logger.warn('监听 UP %s 失败：%s', name, (err as Error).message)
                }
                if (index < cfg.watchUps.length - 1) await ctx.sleep(UP_STAGGER_MS)
            }
        } catch (err) {
            logger.warn('UP 监听失败：%s', (err as Error).message)
        }
    }
    ctx.setInterval(tick, cfg.watchInterval * 60_000)
}

/**
 * Checks the configured HH:MM slots once per minute (Asia/Shanghai) and runs a
 * slop push for each slot that has not fired today.
 */
export function startPush(ctx: Context, cfg: Config, store: Store, makeApi: () => Api, logger: { warn: (...args: unknown[]) => void }) {
    const slots = new Set(cfg.pushTimes.map((time) => time.trim()).filter((time) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(time)).map((time) => time.padStart(5, '0')))
    if (!slots.size) return
    ctx.setInterval(() => {
        const { day, time } = shanghaiNow()
        const key = `${day} ${time}`
        if (!slots.has(time) || store.state.pushSlots[key]) return
        store.state.pushSlots[key] = true
        store.save().catch((err) => logger.warn('记录推送槽位失败：%s', (err as Error).message))
        runPush(ctx, cfg, store, makeApi, logger).catch((err) => logger.warn('找屎搬运异常：%s', (err as Error).message))
    }, 60_000)
}
