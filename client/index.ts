import type { Context } from '@koishijs/client'
import BiliPanel from './BiliPanel.vue'

/**
 * 控制台入口：注册一个「刷B站」页面，页面内部再分「配置 / 总结」两个 tab。
 * 打包成 ESM 由控制台按 entry 加载，`vue` / `@koishijs/client` 与主程序共用实例。
 */
export default (ctx: Context) => {
  ctx.page({
    path: '/bili-slop',
    name: '刷B站',
    desc: '搬运 · 互动 · 日报',
    order: 100,
    component: BiliPanel,
  })
}
