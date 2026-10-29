import type { Context } from '@koishijs/client'
import { icons, router } from '@koishijs/client'
import BiliPanel from './BiliPanel.vue'
import { BiliScreenIcon } from './icons'

const PATH = '/bili-slop'

/** 活动栏图标走 k-icon 的注册表，名字随便取，只要别和内置的重名 */
icons.register('bili-screen', BiliScreenIcon)

/**
 * 用户这次打开页面时真正想去的地址。
 * 读 navigation timing 而不是 location：控制台的 auth 插件在会话恢复后会把地址推去 /profile，
 * 等本插件的 entry 加载完时 location 可能已经不是原来那个了。
 */
function initialPath() {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return entry ? new URL(entry.name).pathname : location.pathname
  } catch {
    return location.pathname
  }
}

/**
 * 控制台入口：注册一个「刷B站」页面，页面内部再分「配置 / 总结」两个 tab。
 * 打包成 ESM 由控制台按 entry 加载，`vue` / `@koishijs/client` 与主程序共用实例。
 */
export default (ctx: Context) => {
  const wanted = initialPath()

  ctx.page({
    path: PATH,
    name: '刷B站',
    desc: '搬运 · 互动 · 日报',
    icon: 'bili-screen',
    order: 100,
    component: BiliPanel,
  })

  if (wanted !== PATH) return
  // 直链打开或刷新时，auth 的会话恢复会无条件 push('/profile') 把页面顶掉；等它落定再补一次
  setTimeout(() => {
    const path = router.currentRoute.value.path
    if (path === PATH || (path !== '/profile' && path !== '/')) return
    router.push(PATH)
  }, 800)
}
