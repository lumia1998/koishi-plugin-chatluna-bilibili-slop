import { Schema } from 'koishi'
import type { Settings } from './settings.js'

/**
 * 配置来源已收敛到 WebUI（`src/settings.ts` + 控制台「配置页」）。
 *
 * ChatLuna 插件详情页保持**空 Schema** —— 这里不再声明任何可配置项，
 * 只在控制台里留一段说明，告诉使用者所有设置都在插件自己的面板里。
 */
export type Config = Settings

export const Config: Schema<Config> = Schema.object({}).description(
    '本插件的全部配置都在控制台的「刷B站」面板里（账号状态 / 偏好设置 / 发布方式 / 互动方式 / 解析方式 / 日报），这里不需要填任何东西。',
) as Schema<Config>
