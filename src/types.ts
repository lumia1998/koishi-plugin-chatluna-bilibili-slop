import type { Bot } from 'koishi'
import type { Internal } from '@lumia.wang/koishi-plugin-adapter-bilibili'

export interface Video {
    bvid: string
    aid: number
    cid: number
    title: string
    author: string
    uid: string
    duration: number
    pubdate: number
    play: number
    comments: number
    description: string
    url: string
    pic?: string
    sources: string[]
}
export interface Comment {
    rpid: string
    root: string
    parent: string
    uid: string
    name: string
    text: string
    likes: number
    mentions: boolean
}
export interface Ranked extends Video {
    score: number
    atRatio: number
    pureAtRatio: number
    feedRatio: number
    evidence: string[]
    fromUp: boolean
    series: boolean
    mygo: boolean
}
export interface Candidate extends Video {
    rank?: Ranked
    hotComments: Comment[]
}
export interface Publication {
    account: string
    bvid: string
    at: string
    text: string
    rpid?: string
    root?: string
    parent?: string
    state: 'sending' | 'sent' | 'unknown'
    visible?: 'public' | 'pending' | 'missing'
    checkedAt?: string
}
export interface Transcript {
    text: string
    source: 'subtitle' | 'asr'
    at: number
}
export interface State {
    version: 2
    comments: Record<string, Publication>
    transcripts: Record<string, Transcript>
    shown: Record<string, number>
    watch: Record<string, number>
    pushSlots: Record<string, true>
}
export interface BiliBot extends Bot {
    internal: Internal
}
