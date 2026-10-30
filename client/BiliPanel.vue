<template>
  <div class="bili-panel">
    <header class="panel-head">
      <div class="panel-title">
        <h2>刷B站</h2>
        <p>搬运、互动、日报都在这里配置；聊天里的工具直接读这份设置。</p>
      </div>
      <nav class="panel-tabs" role="tablist" aria-label="刷B站面板">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="active === tab.id"
          :class="['panel-tab', { 'is-active': active === tab.id }]"
          @click="active = tab.id"
        >
          <span class="panel-tab-icon" aria-hidden="true" v-html="tab.icon"></span>
          <span>{{ tab.label }}</span>
        </button>
      </nav>
    </header>

    <p v-if="error" class="panel-error" role="alert">
      {{ error }}
      <button type="button" class="panel-error-close" aria-label="关闭提示" @click="error = ''">×</button>
    </p>

    <div v-if="!settings" class="panel-loading">
      <span v-if="!loadError">正在读取配置…</span>
      <span v-else>{{ loadError }}</span>
      <button v-if="loadError" type="button" class="k-button primary" @click="reload">重试</button>
    </div>

    <template v-else>
      <BiliConfig
        v-show="active === 'config'"
        :settings="settings"
        @patch="patch"
        @error="showError"
      />
      <BiliHistory v-show="active === 'history'" @error="showError" />
      <BiliViews v-show="active === 'views'" @error="showError" />
      <BiliInteract v-show="active === 'interact'" @error="showError" />
      <BiliDaily v-show="active === 'daily'" @error="showError" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import BiliConfig from './BiliConfig.vue'
import BiliDaily from './BiliDaily.vue'
import BiliHistory from './BiliHistory.vue'
import BiliInteract from './BiliInteract.vue'
import BiliViews from './BiliViews.vue'
import { call } from './api'
import type { Settings } from '../src/settings.js'

/** 24×24 线性图标，颜色跟随按钮文字色 */
const tabIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

const tabs = [
  {
    id: 'config',
    label: '配置',
    icon: tabIcon('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
  },
  {
    id: 'history',
    label: '搬运历史',
    icon: tabIcon('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  },
  {
    id: 'views',
    label: '品鉴历史',
    icon: tabIcon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  },
  {
    id: 'interact',
    label: '互动',
    icon: tabIcon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  },
  {
    id: 'daily',
    label: '日报',
    icon: tabIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  },
] as const

type TabId = typeof tabs[number]['id']

const active = ref<TabId>('config')
const settings = ref<Settings | null>(null)
const error = ref('')
const loadError = ref('')

const pending = new Map<keyof Settings, unknown>()
const timers = new Map<keyof Settings, ReturnType<typeof setTimeout>>()

function showError(message: string) {
  error.value = message
}

/**
 * 改一个字段：本地立即生效，落盘按字段去抖。
 * 服务端返回的是 normalize 过的完整配置，用它回写一次保证前后端一致。
 */
function patch(patchValue: Partial<Settings>) {
  if (!settings.value) return
  const next = { ...settings.value, ...patchValue }
  settings.value = next

  for (const [key, value] of Object.entries(patchValue)) {
    pending.set(key as keyof Settings, value)
    const timer = timers.get(key as keyof Settings)
    if (timer) clearTimeout(timer)
    timers.set(key as keyof Settings, setTimeout(() => flush(key as keyof Settings), 350))
  }
}

function flush(key?: keyof Settings) {
  const keys = key ? [key] : [...pending.keys()]
  const body: Record<string, unknown> = {}
  for (const item of keys) {
    if (!pending.has(item)) continue
    body[item] = pending.get(item)
    pending.delete(item)
    const timer = timers.get(item)
    if (timer) clearTimeout(timer)
    timers.delete(item)
  }
  if (!Object.keys(body).length) return

  call('bili-slop/settings/update', body as Partial<Settings>)
    .then((merged) => { settings.value = merged })
    .catch((err: Error) => showError(`保存配置失败：${err.message}`))
}

function reload() {
  loadError.value = ''
  call('bili-slop/settings')
    .then((value) => { settings.value = value })
    .catch((err: Error) => { loadError.value = `读取配置失败：${err.message}` })
}

onMounted(() => {
  reload()
})

onBeforeUnmount(() => {
  // 面板关掉时还有没落盘的改动，补一次
  flush()
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
})
</script>

<style scoped>
.bili-panel {
  box-sizing: border-box;
  max-width: 84rem;
  margin: 0 auto;
  padding-top: 8px;
  padding-bottom: 48px;
  padding-right: 16px;
  /* 控制台页面容器没有左内边距，窄屏时会被左侧活动栏压住；居中留白够多时不额外让位 */
  padding-left: max(16px, calc(var(--activity-width, 4rem) + 16px - max(0px, (100vw - 84rem) / 2)));
  color: var(--k-text-dark, #333);
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.panel-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}

.panel-title p {
  margin: 4px 0 0;
  color: var(--k-text-light, #999);
  font-size: 13px;
}

.panel-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: var(--k-card-bg, #fff);
}

.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--k-text-normal, #555);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.panel-tab:hover {
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-dark, #333);
}

.panel-tab.is-active {
  color: var(--k-color-primary, #527ca6);
  font-weight: 600;
  background: color-mix(in srgb, var(--k-color-primary, #527ca6) 12%, transparent);
}

.panel-tab-icon {
  display: inline-flex;
  flex: none;
  width: 24px;
  height: 24px;
}

.panel-tab-icon :deep(svg) {
  display: block;
  width: 24px;
  height: 24px;
}

.panel-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 8px 12px;
  border: 1px solid var(--k-color-danger, #e66);
  border-radius: 8px;
  background: var(--k-color-danger-fade, #fdecec);
  color: var(--k-color-danger-shade, #c33);
  font-size: 13px;
  line-height: 1.5;
}

.panel-error-close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.panel-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 120px;
  color: var(--k-text-light, #999);
  font-size: 14px;
}
</style>
