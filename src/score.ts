import type { Comment, Ranked, Video } from './types.js'

const feed = ['吃', '尝', '呕', '吐', '赤石', '屎', '粪', '投喂', '请你', '留着', '下饭', '喂']
const abstract = ['抽象', '整活', '绷', '逆天', '离谱', '发癫', '笑死', '地狱', '神人', '癫', '人类', '电子']
const food = ['吃播', '大胃王', '探店', '教程', '食谱', '餐厅', '自助', '炸鸡', '牛排', '汉堡', '便当', '试吃']

export function duration(value: string | number): number {
    if (typeof value === 'number') return value
    const parts = value.split(':').map(Number)
    if (parts.some((n) => !Number.isFinite(n))) return 0
    return parts.reduce((n, part) => n * 60 + part, 0)
}

export function rank(video: Video, comments: Comment[], now = Date.now()): Ranked {
    const count = comments.length || 1
    const at = comments.filter((c) => c.mentions || c.text.includes('@'))
    const pure = comments.filter((c) => /^(@[^\s@]+\s*)+$/.test(c.text.trim()))
    const feedRatio = comments.filter((c) => feed.some((s) => c.text.includes(s))).length / count
    const abs = comments.filter((c) => abstract.some((s) => c.text.includes(s))).length / count
    const sec = video.duration
    const bonus = sec >= 120 && sec <= 900 ? 1 : sec >= 45 && sec < 120 ? 0.65 : sec > 900 && sec <= 1800 ? 0.8 : sec < 45 ? 0.15 : 0.3
    const fromUp = video.sources.some((s) => s.startsWith('up:'))
    const series = /第\s*[0-9一二三四五六七八九十百]+\s*[期集话]|合集|TV|[①-⑳]/i.test(video.title)
    const mygo = /MyGO|迷子|高松灯|春日影|祥子|爱音|爽世|立希|乐奈|买狗|邦邦|BanG/i.test(video.title)
    const fresh = video.pubdate > 0 && now / 1000 - video.pubdate < 3 * 86400
    const penalty = Math.min(food.filter((s) => video.title.includes(s)).length, 2)
    const score = 35 * at.length / count + 15 * pure.length / count + 30 * bonus
        + 10 * feedRatio + 5 * abs + 5 * Math.min(1, Math.log10(video.comments + 1) / 3.2)
        - 15 * penalty + (fromUp ? 12 : 0) + (series ? 8 : 0) + (mygo ? 6 : 0) + (fresh ? 5 : 0)
    return {
        ...video, score: Math.round(score * 10) / 10,
        atRatio: at.length / count, pureAtRatio: pure.length / count,
        feedRatio, evidence: at.slice(0, 2).map((c) => c.text), fromUp, series, mygo
    }
}

export async function parallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const result: R[] = new Array(items.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            result[index] = await fn(items[index])
        }
    }))
    return result
}
