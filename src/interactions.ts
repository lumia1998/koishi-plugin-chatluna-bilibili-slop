import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InteractionRecord } from './types.js'

/** 时间线只留最近 300 条 */
const LIMIT = 300
/** 和搬运记录 / 品鉴历史一致的 90 天 */
const TTL = 90 * 86400_000

function valid(value: unknown): value is InteractionRecord {
    if (!value || typeof value !== 'object') return false
    const item = value as Partial<InteractionRecord>
    return typeof item.id === 'string' && item.id !== ''
        && typeof item.at === 'string'
        && typeof item.text === 'string'
        && (item.direction === 'out' || item.direction === 'in')
}

/**
 * 互动日志：别人发来的 @ / 回复 / 私信，以及自己发出去的私信。
 *
 * 单独一个文件而不是塞进 `state.json`：台账版本号不用跟着动，
 * 文件坏了也只是丢掉时间线，不影响评论去重和搬运记录。
 */
export class InteractionLog {
    records: InteractionRecord[] = []
    private queue: Promise<unknown> = Promise.resolve()

    constructor(readonly dir: string) {}

    async init() {
        await mkdir(this.dir, { recursive: true })
        try {
            const raw = JSON.parse(await readFile(join(this.dir, 'interactions.json'), 'utf8'))
            if (Array.isArray(raw)) this.records = raw.filter(valid)
        } catch (err) {
            // 文件不存在或坏掉都当作空日志：时间线可丢，评论台账不能丢
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.records = []
        }
    }

    /** 追加若干条：按 id 去重，超过上限的旧记录直接丢掉 */
    add(items: InteractionRecord[]): Promise<void> {
        if (!items.length) return Promise.resolve()
        return this.locked(async () => {
            const seen = new Set(this.records.map((item) => item.id))
            let changed = false
            for (const item of items) {
                if (!valid(item) || seen.has(item.id)) continue
                seen.add(item.id)
                this.records.push(item)
                changed = true
            }
            if (!changed) return
            this.records.sort((a, b) => b.at.localeCompare(a.at))
            this.records = this.records.slice(0, LIMIT)
            await this.save()
        })
    }

    list(): InteractionRecord[] {
        return this.records
    }

    async save() {
        const now = Date.now()
        this.records = this.records.filter((item) => {
            const at = Date.parse(item.at)
            return !Number.isFinite(at) || now - at <= TTL
        })
        const file = join(this.dir, 'interactions.json')
        await writeFile(file + '.tmp', JSON.stringify(this.records, null, 2), 'utf8')
        await rename(file + '.tmp', file)
    }

    /** 串行化读改写，和 `Store.locked` 同一个约定：里面不放网络请求 */
    locked<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.queue.then(fn)
        this.queue = result.catch(() => {})
        return result
    }
}
