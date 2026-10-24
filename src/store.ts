import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Publication, State } from './types.js'

const PUSH_SLOT_TTL = 7 * 86400_000
const SHOWN_TTL = 7 * 86400_000

interface LegacyState {
    version?: number
    comments?: Record<string, Publication>
    seen?: Record<string, string>
    runs?: unknown
}

function empty(): State {
    return { version: 2, comments: {}, transcripts: {}, shown: {}, watch: {}, pushSlots: {} }
}

/** Migrates a persisted state of any known version into the version-2 shape. */
export function migrate(raw: LegacyState): State {
    if (raw.version === 2) {
        const state = raw as unknown as State
        if (!state.comments || !state.transcripts || !state.shown || !state.watch || !state.pushSlots) {
            throw new Error('损坏的台账格式')
        }
        return state
    }
    if (raw.version === 1) {
        if (!raw.comments || !raw.seen) throw new Error('不支持或损坏的台账格式')
        const state = empty()
        state.comments = raw.comments
        // Legacy seen keys were "<account>:<scope>:<bvid>"; keep only the bvid.
        for (const key of Object.keys(raw.seen)) {
            const bvid = key.split(':').pop()
            if (bvid && /^BV[0-9A-Za-z]{10}$/.test(bvid)) state.shown[bvid] = Date.now()
        }
        return state
    }
    throw new Error('不支持或损坏的台账格式')
}

export class Store {
    state: State = empty()
    private queue: Promise<unknown> = Promise.resolve()

    constructor(readonly dir: string) {}

    async init() {
        await mkdir(this.dir, { recursive: true })
        try {
            const raw = JSON.parse(await readFile(join(this.dir, 'state.json'), 'utf8')) as LegacyState
            this.state = migrate(raw)
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
    }

    async save() {
        this.prune()
        const file = join(this.dir, 'state.json')
        await writeFile(file + '.tmp', JSON.stringify(this.state, null, 2), 'utf8')
        await rename(file + '.tmp', file)
    }

    /** Drops expired shown / pushSlot entries before persisting. */
    private prune() {
        const now = Date.now()
        for (const [bvid, at] of Object.entries(this.state.shown)) {
            if (now - at > SHOWN_TTL) delete this.state.shown[bvid]
        }
        for (const slot of Object.keys(this.state.pushSlots)) {
            const at = Date.parse(slot.replace(' ', 'T') + ':00+08:00')
            if (Number.isFinite(at) && now - at > PUSH_SLOT_TTL) delete this.state.pushSlots[slot]
        }
    }

    /** Serializes state read-modify-write blocks. Never put network or ASR work inside. */
    locked<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.queue.then(fn)
        this.queue = result.catch(() => {})
        return result
    }
}
