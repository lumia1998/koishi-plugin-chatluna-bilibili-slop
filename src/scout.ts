import type { Api } from './api.js'
import { parallel, rank } from './score.js'
import type { Candidate, Video } from './types.js'

export const CHISHI_KEYWORDS = ['赤石视频', '赤石', '大份视频', '散装大粪', '互联网散装大粪', '抽象视频']

// Tuning constants formerly exposed as configuration.
const DAYS = 7
const MAX_SCAN = 12
const MIN_AT_RATIO = 0.3
const MIN_DURATION = 45

/**
 * Recalls slop candidates from tracked UP uploads, keyword searches and related
 * videos, then keeps only those whose hot comments show enough @ / feeding
 * behaviour. No subtitles are read and no ASR runs here.
 */
export async function scout(api: Api, keywords: string[], ups: string[]) {
    const pool = new Map<string, Video>()
    const errors: string[] = []
    const add = (list: Video[]) => {
        for (const item of list) {
            if (!item.bvid) continue
            const old = pool.get(item.bvid)
            if (old) old.sources = [...new Set([...old.sources, ...item.sources])]
            else pool.set(item.bvid, item)
        }
    }
    const jobs: (() => Promise<Video[]>)[] = []
    for (const up of ups.slice(0, 12)) jobs.push(() => api.up(up, DAYS))
    for (const word of (keywords.length ? keywords : CHISHI_KEYWORDS).slice(0, 6)) {
        for (const order of ['totalrank', 'pubdate'] as const) {
            for (const page of [1, 2]) jobs.push(() => api.search(word, order, page))
        }
    }
    await parallel(jobs, 4, async (job) => {
        try { add(await job()) } catch (err) { errors.push((err as Error).message) }
    })
    await parallel([...pool.values()].sort((a, b) => b.play - a.play).slice(0, 3), 3, async (item) => {
        try { add(await api.related(item.bvid)) } catch (err) { errors.push((err as Error).message) }
    })
    const since = Date.now() / 1000 - DAYS * 86400
    const alive = [...pool.values()].filter((item) => !item.pubdate || item.pubdate >= since)
    const pre = (item: Video) => (item.sources.some((s) => s.startsWith('up:')) ? 2 : 0)
        + (/赤石|大份|大粪|散装|抽象|猎奇/.test(item.title) ? 2 : 0)
        + Math.min(1, Math.log10(item.comments + 1) / 3.2)
    const sorted = [...alive].sort((a, b) => pre(b) - pre(a))
    const selected = new Map(sorted.slice(0, Math.ceil(MAX_SCAN / 2)).map((v) => [v.bvid, v]))
    for (const item of [...alive].sort((a, b) => b.comments - a.comments)) {
        if (selected.size >= MAX_SCAN) break
        selected.set(item.bvid, item)
    }
    const rows = await parallel([...selected.values()], 4, async (item): Promise<Candidate | undefined> => {
        try {
            const full = { ...await api.info(item.bvid), sources: item.sources }
            if (full.pubdate < since) return
            const hotComments = await api.comments(full)
            const ranked = rank(full, hotComments)
            if (ranked.atRatio < MIN_AT_RATIO || full.duration < MIN_DURATION || ranked.feedRatio === 0) return
            return { ...full, hotComments, rank: ranked }
        } catch (err) { errors.push(`${item.bvid}: ${(err as Error).message}`) }
    })
    const items = rows.filter((item): item is Candidate => !!item)
    items.sort((a, b) => b.rank!.score - a.rank!.score)
    return { candidates: pool.size, scanned: selected.size, items, errors }
}
