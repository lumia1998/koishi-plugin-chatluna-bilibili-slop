<template>
  <div class="bili-daily">
    <div class="daily-bar">
      <div class="date-controls">
        <label for="bili-daily-day">日期</label>
        <input id="bili-daily-day" v-model="day" type="date" class="k-date" @change="load">
        <button type="button" class="k-button frameless primary" :disabled="day === todayDay" @click="day = todayDay; load()">
          今天
        </button>
      </div>
      <div class="daily-actions">
        <span v-if="copyMessage" class="copy-message">{{ copyMessage }}</span>
        <button type="button" class="k-button primary" :disabled="!report || generating" @click="generate">
          {{ generating ? '生成中…' : 'AI 写日报' }}
        </button>
        <button type="button" class="k-button" :disabled="!report || copying" @click="exportReport">
          {{ copying ? '复制中…' : '导出日报' }}
        </button>
      </div>
    </div>

    <div v-if="recentDays.length" class="recent-days">
      <button
        v-for="item in recentDays"
        :key="item.day"
        type="button"
        class="day-chip"
        :class="{ active: item.day === day }"
        @click="day = item.day; load()"
      >{{ item.day.slice(5) }} · {{ item.count }}</button>
    </div>

    <section class="k-card group">
      <div class="group-head">
        <h3>日常日报</h3>
        <span v-if="loading" class="group-tip">读取中…</span>
        <span v-else-if="aiModel" class="group-tip">AI · {{ aiModel }}</span>
        <span v-else-if="generating" class="group-tip">模型正在写…</span>
        <span v-else-if="report" class="group-tip">{{ day }}</span>
      </div>

      <article v-if="report" class="report markdown" v-html="html"></article>
      <p v-else-if="!loading" class="empty-text">{{ day }} 还没有日报。</p>

      <p v-if="report && !aiModel" class="desc">
        这是按记录拼出的清单；在「配置页 → 日报」里选一个模型后可以点「AI 写日报」。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { call, today } from './api'
import { renderMarkdown } from './markdown'

const emit = defineEmits<{ (event: 'error', message: string): void }>()

const todayDay = today()
const day = ref(todayDay)
const report = ref('')
const recentDays = ref<{ day: string, count: number }[]>([])
const loading = ref(false)
const copying = ref(false)
const copyMessage = ref('')
const generating = ref(false)
const aiModel = ref('')

const html = computed(() => renderMarkdown(report.value))

let copyTimer: ReturnType<typeof setTimeout> | undefined

function load() {
  loading.value = true
  // 换日期就丢掉上一天的 AI 正文，免得日期和内容对不上
  aiModel.value = ''
  call('bili-slop/summary', { day: day.value })
    .then((result) => { report.value = result.report })
    .catch((err: Error) => {
      report.value = ''
      emit('error', `读取日报失败：${err.message}`)
    })
    .finally(() => { loading.value = false })
}

function loadRecent() {
  call('bili-slop/reports', { days: 14 })
    .then((result) => { recentDays.value = result })
    .catch(() => { recentDays.value = [] })
}

/** 一次模型调用，可能要几十秒：按钮置灰，失败就保留原来的清单 */
function generate() {
  if (generating.value) return
  generating.value = true
  copyMessage.value = ''
  call('bili-slop/summary/generate', { day: day.value })
    .then((result) => {
      report.value = result.report
      aiModel.value = result.model
    })
    .catch((err: Error) => {
      emit('error', `生成日报失败：${err.message}`)
    })
    .finally(() => { generating.value = false })
}

async function exportReport() {
  const text = report.value
  if (!text) return
  copying.value = true
  try {
    await copy(text)
    copyMessage.value = '日报已复制到剪贴板'
  } catch {
    copyMessage.value = '复制失败，请手动全选日报内容'
  } finally {
    copying.value = false
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copyMessage.value = '' }, 3000)
  }
}

/** 剪贴板 API 只在安全上下文可用，退回 textarea */
async function copy(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(area)
  if (!ok) throw new Error('copy failed')
}

onMounted(() => {
  load()
  loadRecent()
})
</script>

<style scoped>
.bili-daily {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.daily-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.date-controls,
.daily-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.date-controls label {
  color: var(--k-text-normal, #555);
  font-size: 13px;
}

.k-date {
  padding: 6px 10px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 8px;
  background: var(--k-card-bg, #fff);
  color: var(--k-text-dark, #333);
  font: inherit;
  font-size: 13px;
}

.copy-message {
  color: var(--k-color-success, #3ba55e);
  font-size: 12px;
}

.recent-days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.day-chip {
  padding: 4px 10px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 999px;
  background: var(--k-card-bg, #fff);
  color: var(--k-text-normal, #666);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.day-chip.active {
  border-color: var(--k-color-primary, #527ca6);
  color: var(--k-color-primary, #527ca6);
  background: var(--k-color-primary-fade, #eef4fb);
}

.group {
  padding: 16px 20px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 12px;
  background: var(--k-card-bg, #fff);
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.group-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.group-tip {
  color: var(--k-text-light, #999);
  font-size: 12px;
}

.empty-text {
  margin: 0;
  color: var(--k-text-light, #999);
  font-size: 13px;
}

.desc {
  margin: 12px 0 0;
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.6;
}

/* 日报正文：Markdown 渲染后的排版 */

.markdown {
  color: var(--k-text-dark, #2b2f36);
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
}

.markdown :deep(h2) {
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--k-color-divider-light, #f0f2f5);
  font-size: 18px;
  font-weight: 600;
}

.markdown :deep(h3) {
  margin: 18px 0 8px;
  font-size: 15px;
  font-weight: 600;
}

.markdown :deep(h4) {
  margin: 14px 0 6px;
  font-size: 14px;
  font-weight: 600;
}

.markdown :deep(p) { margin: 0 0 10px; }

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}

.markdown :deep(li) { margin: 2px 0; }

.markdown :deep(a) {
  color: var(--k-color-primary, #527ca6);
  text-decoration: none;
}

.markdown :deep(a:hover) { text-decoration: underline; }

.markdown :deep(blockquote) {
  margin: 0 0 10px;
  padding: 8px 12px;
  border-left: 3px solid var(--k-color-divider, #dce0e5);
  background: var(--k-hover-bg, #f7f8fa);
  color: var(--k-text-normal, #555);
  border-radius: 0 8px 8px 0;
}

.markdown :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--k-hover-bg, #f3f5f8);
  font-size: 13px;
}

.markdown :deep(pre) {
  margin: 0 0 10px;
  padding: 12px;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--k-hover-bg, #f3f5f8);
}

.markdown :deep(pre code) { padding: 0; background: transparent; }

.markdown :deep(hr) {
  margin: 16px 0;
  border: 0;
  border-top: 1px solid var(--k-color-divider-light, #f0f2f5);
}
</style>
