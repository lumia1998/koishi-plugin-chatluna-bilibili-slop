import { send as rawSend } from '@koishijs/client'
import type { Settings } from '../src/settings.js'
import type { ShuttleRecord } from '../src/types.js'

/**
 * 控制台的 `send` 只认识内置事件（`ping` 等），自定义 RPC 由本插件自己约定。
 * 这里集中声明一遍参数/返回值，别处就不用到处写泛型。
 */
export interface Rpc {
  'bili-slop/settings': { args: [], result: Settings }
  'bili-slop/settings/update': { args: [Partial<Settings>], result: Settings }
  'bili-slop/status': { args: [], result: ConsoleStatus }
  'bili-slop/login/start': { args: [], result: { key: string, url: string } }
  'bili-slop/login/poll': { args: [{ key: string }], result: LoginPoll }
  'bili-slop/shuttle': { args: [], result: { ok: boolean } }
  'bili-slop/verify': { args: [], result: unknown }
  'bili-slop/summary': { args: [{ day?: string }], result: { report: string, wall: ShuttleRecord[] } }
  'bili-slop/reports': { args: [{ days?: number }], result: { day: string, count: number }[] }
  'bili-slop/models': { args: [], result: { models: ReportModel[], selected: string } }
  'bili-slop/summary/generate': { args: [{ day?: string }], result: { report: string, model: string } }
}

/** 配置页下拉里的一个 ChatLuna 模型；name 是 `platform/name` 全名 */
export interface ReportModel {
  name: string
  platform: string
}

export interface ConsoleStatus {
  loggedIn: boolean
  selfId: string
  nickname?: string
  refreshedAt?: string | number
  ownerUid: string
  features: {
    comment: boolean
    replyRoot: boolean
    replySub: boolean
    dm: boolean
    transcribe: boolean
    shuttle: boolean
  }
  ledger: { bvid: string, text: string, at: string, state: string, visible?: string }[]
  lastRun?: { at: string, picks: number, errors: string[] }
}

export interface LoginPoll {
  state: 'waiting' | 'scanned' | 'expired' | 'ok' | 'unknown'
  message?: string
}

const dispatch = rawSend as unknown as (type: string, ...args: unknown[]) => Promise<unknown> | undefined

/** 调一个控制台 RPC；服务端抛错时控制台回的是 `error` 字段，这里统一成中文 */
export async function call<K extends keyof Rpc>(type: K, ...args: Rpc[K]['args']): Promise<Rpc[K]['result']> {
  let task: Promise<unknown> | undefined
  try {
    task = dispatch(type, ...args)
  } catch (error) {
    throw new Error(explain(error))
  }
  if (!task) throw new Error('控制台连接已断开，请刷新页面后重试')

  try {
    return await task as Rpc[K]['result']
  } catch (error) {
    throw new Error(explain(error))
  }
}

/** 控制台的 error 可能是字符串、`{ name, message }` 或 Error，挑出能看的那个 */
function explain(error: unknown): string {
  if (!error) return '请求失败，但服务端没有给出原因'
  if (typeof error === 'string') return error === 'timeout' ? '请求超时，服务端可能还在处理，稍后刷新看看' : error
  if (typeof error === 'object') {
    const value = error as { message?: unknown, name?: unknown }
    if (typeof value.message === 'string' && value.message) {
      return value.message === 'timeout' ? '请求超时，服务端可能还在处理，稍后刷新看看' : value.message
    }
    if (typeof value.name === 'string' && value.name) return value.name
  }
  return '请求失败，请稍后重试'
}

/** Asia/Shanghai 的 YYYY-MM-DD，跟日报的切日口径一致 */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** `mm:ss`；小时以上补成 `h:mm:ss` */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes < 60) return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** 10000 以上按 `x.x万` 显示 */
export function views(count: number): string {
  const value = Math.max(0, Math.round(Number(count) || 0))
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : String(value)
}

/** 时间戳/ISO 串 → 本地「月-日 时:分」，认不出来就原样返回 */
export function moment(value: string | number | undefined): string {
  if (value === undefined || value === '') return '—'
  const time = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(time)) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(time))
}
