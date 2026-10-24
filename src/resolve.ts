const XOR_CODE = 23442827791579n
const MASK_CODE = 2251799813685247n
const MAX_AID = 1n << 51n
const BASE = 58n
const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'

function swap(chars: string[]) {
    [chars[3], chars[9]] = [chars[9], chars[3]]
    ;[chars[4], chars[7]] = [chars[7], chars[4]]
    return chars
}

/** Standard av to BV conversion. av170001 -> BV17x411w7KC. */
export function av2bv(aid: number | bigint): string {
    const value = BigInt(aid)
    if (value <= 0n || value >= MAX_AID) throw new Error(`无效的 av 号：${aid}`)
    const out = 'BV1000000000'.split('')
    let rest = (MAX_AID | value) ^ XOR_CODE
    for (let i = out.length - 1; rest > 0n; i--) {
        out[i] = ALPHABET[Number(rest % BASE)]
        rest /= BASE
    }
    return swap(out).join('')
}

/** BV to av conversion (inverse of av2bv). */
export function bv2av(bvid: string): bigint {
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error(`无效的 BV 号：${bvid}`)
    let value = 0n
    for (const char of swap(bvid.split('')).slice(3)) {
        const index = ALPHABET.indexOf(char)
        if (index < 0) throw new Error(`无效的 BV 号：${bvid}`)
        value = value * BASE + BigInt(index)
    }
    return (value & MASK_CODE) ^ XOR_CODE
}

const BV_PATTERN = /BV[0-9A-Za-z]{10}/
const AV_PATTERN = /(?:^|[\s/])av(\d{1,15})(?:\b|[^\d]|$)/i

/** Extracts a BV id from any user-provided string (number, URL, short link text). */
export function extractBv(input: string): string | undefined {
    const bv = input.match(BV_PATTERN)
    if (bv) return bv[0]
    const av = input.match(AV_PATTERN)
    if (av) return av2bv(BigInt(av[1]))
    // bare "av123" at the very start
    const bare = input.match(/^av(\d{1,15})$/i)
    if (bare) return av2bv(BigInt(bare[1]))
    return undefined
}

const SHORT_HOSTS = new Set(['b23.tv', 'www.b23.tv', 'bili2233.cn', 'www.bili2233.cn'])
const ALLOWED_HOST = /(^|\.)bilibili\.com$/

export interface FetchLike {
    (url: string, init: { redirect: 'manual'; signal?: AbortSignal }): Promise<{ status: number; headers: { get(name: string): string | null } }>
}

/**
 * Resolves b23.tv / bili2233.cn short links by following Location headers only
 * (no page download). At most 3 hops; redirects must stay on bilibili.com or
 * the short-link hosts themselves, otherwise resolution is refused.
 */
export async function resolveShortLink(url: string, fetchImpl?: FetchLike): Promise<string> {
    let current = url
    const fetcher = fetchImpl || (fetch as unknown as FetchLike)
    for (let hop = 0; hop < 3; hop++) {
        let parsed: URL
        try { parsed = new URL(current) } catch { throw new Error('无效的链接') }
        const host = parsed.hostname.toLowerCase()
        if (!SHORT_HOSTS.has(host) && !ALLOWED_HOST.test(host)) {
            throw new Error(`不允许访问的链接域名：${parsed.hostname}`)
        }
        if (!SHORT_HOSTS.has(host)) {
            const bv = extractBv(current)
            if (bv) return bv
            throw new Error('无法从链接中识别视频')
        }
        const response = await fetcher(current, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
        const location = response.headers.get('location')
        const isRedirect = response.status >= 300 && response.status < 400
        if (!location || !isRedirect) {
            const bv = extractBv(current)
            if (bv) return bv
            throw new Error('短链未返回跳转地址')
        }
        let next: URL
        try { next = new URL(location, parsed) } catch { throw new Error('短链返回了无效的跳转地址') }
        const nextHost = next.hostname.toLowerCase()
        if (!ALLOWED_HOST.test(nextHost) && !SHORT_HOSTS.has(nextHost)) {
            throw new Error(`短链跳转到非 B站域名：${next.hostname}`)
        }
        const bv = extractBv(next.href)
        if (bv) return bv
        current = next.href
    }
    throw new Error('短链跳转次数过多')
}

export const RESOLVE_HINT = '无法识别视频，请提供 BV 号、av 号或 B站视频链接'

/**
 * Turns any accepted video reference into a BV id:
 * BV id, av id, bilibili.com URL, or b23.tv / bili2233.cn short link.
 */
export async function resolveVideo(input: string, fetchImpl?: FetchLike): Promise<string> {
    const text = (input || '').trim()
    if (!text) throw new Error(RESOLVE_HINT)
    const direct = extractBv(text)
    if (direct) return direct
    if (/^https?:\/\//i.test(text)) {
        const parsed = new URL(text)
        const host = parsed.hostname.toLowerCase()
        if (SHORT_HOSTS.has(host)) return await resolveShortLink(text, fetchImpl)
        if (ALLOWED_HOST.test(host)) {
            const bv = extractBv(text)
            if (bv) return bv
        }
    }
    throw new Error(RESOLVE_HINT)
}

/** Splits a user reference into a numeric UID or an exact nickname. */
export function parseUserInput(input: string): { uid?: string; name?: string } {
    const text = (input || '').trim()
    if (!text) return {}
    if (/^\d+$/.test(text)) return { uid: text }
    return { name: text }
}
