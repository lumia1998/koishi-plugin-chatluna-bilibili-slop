import type { Store } from './store.js'
import type { ShuttleRecord } from './types.js'

const TIMEZONE = 'Asia/Shanghai'
const WALL_DAYS = 7
const INDEX_DAYS = 30

/** `en-CA` 的 format() 就是 YYYY-MM-DD，正好是日报用的日期串 */
const dayFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** 当前 Asia/Shanghai 的日期（不跟随服务器本地时区） */
function today(): string {
    return dayFormat.format(new Date())
}

/** 时间戳归到 Shanghai 的某一天 */
function dayOf(time: number): string | undefined {
    if (!Number.isFinite(time)) return undefined
    return dayFormat.format(new Date(time))
}

/** day 前后挪 delta 天；固定 +08:00 没有夏令时，直接加减毫秒是精确的 */
function shift(day: string, delta: number): string {
    const time = Date.parse(`${day}T00:00:00+08:00`)
    return dayOf(time + delta * 86400_000) ?? day
}

/** 近 span 天的日期集合（含今天） */
function window_(span: number): Set<string> {
    const days = new Set<string>()
    for (let i = 0; i < span; i++) days.add(shift(today(), -i))
    return days
}

/** `mm:ss`；分钟也补零，保证列对齐 */
export function clock(seconds: number): string {
    const total = Math.max(0, Math.floor(Number(seconds) || 0))
    const minutes = Math.floor(total / 60)
    return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 10000 以上按 `x.x万` 显示，保留一位小数 */
export function views(count: number): string {
    const value = Math.max(0, Math.round(Number(count) || 0))
    return value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : String(value)
}

function link(record: ShuttleRecord): string {
    return record.url || `https://www.bilibili.com/video/${record.bvid}`
}

/** 卡片/日报里正文只占一行，多行理由压平 */
function oneLine(text: string | undefined): string {
    return (text || '').replace(/\s+/g, ' ').trim()
}

function timeOf(record: ShuttleRecord): number {
    const time = Date.parse(record.at)
    return Number.isFinite(time) ? time : 0
}

/** 某一天的记录，按 at 倒序 */
export function pick(store: Store, day: string): ShuttleRecord[] {
    return Object.values(store.state.shuttles || {})
        .filter((record) => dayOf(timeOf(record)) === day)
        .sort((a, b) => timeOf(b) - timeOf(a))
}

/** 全部记录按天分组，日期倒序、每天内 at 倒序 */
function groupByDay(store: Store): { day: string, items: ShuttleRecord[] }[] {
    const buckets = new Map<string, ShuttleRecord[]>()
    for (const record of Object.values(store.state.shuttles || {})) {
        const day = dayOf(timeOf(record))
        if (!day) continue
        const bucket = buckets.get(day)
        if (bucket) bucket.push(record)
        else buckets.set(day, [record])
    }
    return [...buckets.entries()]
        .map(([day, items]) => ({ day, items: items.sort((a, b) => timeOf(b) - timeOf(a)) }))
        .sort((a, b) => b.day.localeCompare(a.day))
}

/** 窗口里有记录就用窗口；一条都没有时退回最近的那些天，免得页面空着 */
function recent(store: Store, windowSpan: number, limit: number) {
    const all = groupByDay(store)
    const days = window_(windowSpan)
    const inside = all.filter((group) => days.has(group.day))
    return (inside.length ? inside : all).slice(0, limit)
}

/** 一条记录的日报条目（Markdown 列表） */
function entry(record: ShuttleRecord): string {
    const meta = [`时长 ${clock(record.duration)}`]
    if (typeof record.play === 'number' && Number.isFinite(record.play)) meta.push(`播放 ${views(record.play)}`)
    if (typeof record.comments === 'number' && Number.isFinite(record.comments)) meta.push(`评论 ${Math.round(record.comments)}`)
    return [
        `### ${record.bvid}`,
        `- 标题：${oneLine(record.title)}`,
        `- UP：${oneLine(record.author)}（UID ${record.uid || '未知'}）`,
        `- ${meta.join(' · ')}`,
        `- 搬运理由：${oneLine(record.reason) || '（无）'}`,
        `- 链接：${link(record)}`,
    ].join('\n')
}

/** 某天的日报（Markdown，给人看）；day 为空时用今天 */
export function dailyReport(store: Store, day: string): string {
    const target = String(day || '').trim() || today()
    const title = `# ${target} 刷B站日报`
    const items = pick(store, target)
    if (!items.length) return `${title}\n\n今天没有搬运任何视频。`
    return `${title}\n\n共 ${items.length} 条\n\n${items.map(entry).join('\n\n')}`
}

/** 照片墙数据：按天分组的搬运记录；day 为空时取近 7 天 */
export function wall(store: Store, day: string): { day: string, items: ShuttleRecord[] }[] {
    const target = String(day || '').trim()
    if (target) {
        const items = pick(store, target)
        return items.length ? [{ day: target, items }] : []
    }
    return recent(store, WALL_DAYS, WALL_DAYS)
}

/** 近 N 天每天的搬运条数，日期倒序，只含有记录的日期 */
export function reportIndex(store: Store, days = INDEX_DAYS): { day: string, count: number }[] {
    const raw = Number(days)
    const span = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 3650) : INDEX_DAYS
    return recent(store, span, span).map((group) => ({ day: group.day, count: group.items.length }))
}
