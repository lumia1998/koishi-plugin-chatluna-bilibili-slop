import type { Context } from 'koishi'
import type { Api } from './api.js'
import type { Config } from './config.js'
import type { Store } from './store.js'

const TIMEZONE = 'Asia/Shanghai'

/** 只用到这两档；用方法签名是为了能直接吃 Koishi 的 ctx.logger(name) */
export interface Logger {
    info(format: string, ...args: any[]): void
    warn(format: string, ...args: any[]): void
}

/** 当前 Asia/Shanghai 的日期与时刻 */
export function shanghaiNow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date())
    const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
    const hour = get('hour') === '24' ? '00' : get('hour')
    return {
        day: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${hour}:${get('minute')}`,
    }
}

/**
 * 每日定时搬运。
 *
 * 唯一的调度源是 `settings.pushTimes`（如 ["12:00","20:00"]）。
 * 到点后调调用方传进来的 `run()` —— 它负责召回 + 打分 + 三种发布方式，
 * 本文件只管「今天这个时刻推过没有」，不碰业务。
 */
export function startPush(
    ctx: Context,
    cfg: Config,
    store: Store,
    _makeApi: () => Api,
    logger: Logger,
    run: () => Promise<unknown>,
) {
    const slots = new Set(
        (cfg.pushTimes || [])
            .map((time) => String(time || '').trim())
            .filter((time) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(time))
            .map((time) => time.padStart(5, '0')),
    )
    if (!slots.size) {
        logger.info('未配置每日搬运时刻（pushTimes），定时搬运不启动')
        return
    }

    let running = false
    logger.info('定时搬运已启动：每天 %s', [...slots].join(' / '))

    ctx.setInterval(() => {
        const { day, time } = shanghaiNow()
        const key = `${day} ${time}`
        if (!slots.has(time) || store.state.pushSlots[key] || running) return
        running = true
        store.state.pushSlots[key] = true
        store.save().catch((err) => logger.warn('记录推送槽位失败：%s', (err as Error).message))
        run()
            .catch((err) => logger.warn('定时搬运异常：%s', (err as Error).message))
            .finally(() => { running = false })
    }, 60_000)
}
