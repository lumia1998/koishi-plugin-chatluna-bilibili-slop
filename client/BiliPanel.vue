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
          :class="{ active: active === tab.id }"
          @click="active = tab.id"
        >{{ tab.label }}</button>
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
      <BiliSummary
        v-show="active === 'summary'"
        @error="showError"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import BiliConfig from './BiliConfig.vue'
import BiliSummary from './BiliSummary.vue'
import { call } from './api'
import type { Settings } from '../src/settings.js'

const tabs = [
  { id: 'config', label: '配置' },
  { id: 'summary', label: '总结' },
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
  max-width: 60rem;
  margin: 0 auto;
  padding: 8px 0 48px;
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
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: var(--k-hover-bg, #f3f5f8);
}

.panel-tabs button {
  border: 0;
  padding: 6px 18px;
  border-radius: 8px;
  background: transparent;
  color: var(--k-text-normal, #555);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.panel-tabs button:hover {
  color: var(--k-text-dark, #333);
}

.panel-tabs button.active {
  background: var(--k-card-bg, #fff);
  color: var(--k-color-primary, #527ca6);
  font-weight: 600;
  box-shadow: 0 1px 4px #0000001a;
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
