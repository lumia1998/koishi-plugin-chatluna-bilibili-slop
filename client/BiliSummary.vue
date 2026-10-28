<template>
  <div class="bili-summary">
    <div class="summary-bar">
      <div class="date-controls">
        <label for="bili-summary-day">日期</label>
        <input id="bili-summary-day" v-model="day" type="date" class="k-date" @change="loadSummary">
        <button type="button" class="k-button frameless primary" :disabled="day === todayDay" @click="day = todayDay; loadSummary()">
          今天
        </button>
      </div>
      <div class="summary-actions">
        <span v-if="copyMessage" class="copy-message">{{ copyMessage }}</span>
        <button type="button" class="k-button primary" :disabled="!wall.length || generating" @click="generate">
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
        @click="day = item.day; loadSummary()"
      >{{ item.day.slice(5) }} · {{ item.count }}</button>
    </div>

    <section class="k-card group">
      <div class="group-head">
        <h3>日常日报</h3>
        <span v-if="loading" class="group-tip">读取中…</span>
        <span v-else-if="aiModel" class="group-tip">AI · {{ aiModel }}</span>
        <span v-else-if="generating" class="group-tip">模型正在写…</span>
      </div>
      <pre v-if="report" class="report">{{ report }}</pre>
      <p v-else-if="!loading" class="empty-text">{{ day }} 还没有日报。</p>
      <p v-if="report && !aiModel" class="desc">这是按记录拼出的清单；在「配置页 → 日报」里选一个模型后可以点「AI 写日报」。</p>
    </section>

    <section class="k-card group">
      <div class="group-head">
        <h3>照片墙</h3>
        <span class="group-tip">{{ wall.length ? `共 ${wall.length} 条` : '' }}</span>
      </div>

      <div v-if="wall.length" class="wall">
        <article
          v-for="record in wall"
          :key="record.bvid"
          class="cell"
          tabindex="0"
          role="button"
          :aria-label="`查看 ${record.title} 的详情`"
          @click="open(record)"
          @keydown.enter.prevent="open(record)"
          @keydown.space.prevent="open(record)"
        >
          <div class="cover">
            <img v-if="record.pic" :src="record.pic" :alt="record.title" loading="lazy" referrerpolicy="no-referrer">
            <div v-else class="cover-fallback" aria-hidden="true">{{ firstChar(record.title) }}</div>
            <span class="duration">{{ clock(record.duration) }}</span>
            <span v-if="record.delivery?.length" class="delivery">
              <span v-for="channel in record.delivery" :key="channel">{{ CHANNEL_TEXT[channel] || channel }}</span>
            </span>
          </div>
          <h4 class="cell-title">{{ record.title }}</h4>
          <p class="cell-meta">{{ record.author }}</p>
        </article>
      </div>

      <p v-else-if="!loading" class="empty-text">今天还没有搬运记录。</p>
    </section>

    <!-- 详情浮层 -->
    <div v-if="selected" class="overlay" role="dialog" aria-modal="true" aria-label="搬运详情" @click.self="close">
      <div class="detail">
        <button type="button" class="detail-close" aria-label="关闭" @click="close">×</button>

        <div class="detail-cover">
          <img v-if="selected.pic" :src="selected.pic" :alt="selected.title" referrerpolicy="no-referrer">
          <div v-else class="cover-fallback" aria-hidden="true">{{ firstChar(selected.title) }}</div>
        </div>

        <div class="detail-body">
          <h3 class="detail-title">{{ selected.title }}</h3>

          <dl class="detail-facts">
            <div><dt>作者</dt><dd>{{ selected.author }}</dd></div>
            <div><dt>UID</dt><dd>{{ selected.uid || '—' }}</dd></div>
            <div><dt>时长</dt><dd>{{ clock(selected.duration) }}</dd></div>
            <div><dt>搬运时间</dt><dd>{{ moment(selected.at) }}</dd></div>
            <div v-if="play !== undefined"><dt>播放</dt><dd>{{ views(play) }}</dd></div>
            <div v-if="comments !== undefined"><dt>评论</dt><dd>{{ views(comments) }}</dd></div>
            <div v-if="selected.score !== undefined"><dt>得分</dt><dd>{{ Math.round(selected.score) }}</dd></div>
            <div v-if="selected.atRatio !== undefined"><dt>@ 占比</dt><dd>{{ Math.round(selected.atRatio * 100) }}%</dd></div>
          </dl>

          <section class="detail-block">
            <h4>搬运理由</h4>
            <p class="reason">{{ selected.reason || '（这条没有写理由）' }}</p>
          </section>

          <section v-if="selected.content" class="detail-block">
            <h4>内容摘要</h4>
            <p class="content">{{ selected.content }}</p>
          </section>

          <section v-if="selected.evidence?.length" class="detail-block">
            <h4>证据热评</h4>
            <blockquote v-for="(item, index) in selected.evidence" :key="index">{{ item }}</blockquote>
          </section>

          <section v-if="selected.delivery?.length" class="detail-block">
            <h4>已推送</h4>
            <p>{{ selected.delivery.map((channel) => CHANNEL_TEXT[channel] || channel).join(' / ') }}</p>
          </section>

          <a class="k-link detail-link" :href="selected.url || `https://www.bilibili.com/video/${selected.bvid}`" target="_blank" rel="noreferrer">
            在 B站打开 ↗
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { call, clock, moment, today, views } from './api'
import type { ShuttleRecord } from '../src/types.js'

const emit = defineEmits<{ (event: 'error', message: string): void }>()

const todayDay = today()
const day = ref(todayDay)
const report = ref('')
const wall = ref<ShuttleRecord[]>([])
const recentDays = ref<{ day: string, count: number }[]>([])
const loading = ref(false)
const copying = ref(false)
const copyMessage = ref('')
const selected = ref<ShuttleRecord | null>(null)
/** AI 日报：generating 时按钮转圈；aiModel 有值说明当前正文来自模型 */
const generating = ref(false)
const aiModel = ref('')

const CHANNEL_TEXT: Record<string, string> = {
  comment: '评论',
  dm: '私信',
  group: '群',
}

let copyTimer: ReturnType<typeof setTimeout> | undefined

/**
 * `play` / `comments` 目前不在 ShuttleRecord 的契约里，
 * 但照片墙详情希望展示；有就显示，没有就不占位。
 */
const play = computed(() => readNumber(selected.value, 'play'))
const comments = computed(() => readNumber(selected.value, 'comments'))

function readNumber(record: ShuttleRecord | null, key: string): number | undefined {
  if (!record) return undefined
  const value = (record as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function firstChar(title: string): string {
  return (title || '?').trim().slice(0, 1) || '?'
}

function loadSummary() {
  loading.value = true
  // 换日期就丢掉上一天的 AI 正文，免得日期和内容对不上
  aiModel.value = ''
  call('bili-slop/summary', { day: day.value })
    .then((result) => {
      report.value = result.report
      wall.value = result.wall
    })
    .catch((err: Error) => {
      report.value = ''
      wall.value = []
      emit('error', `读取总结失败：${err.message}`)
    })
    .finally(() => { loading.value = false })
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

function loadRecent() {
  call('bili-slop/reports', { days: 14 })
    .then((result) => { recentDays.value = result })
    .catch(() => { recentDays.value = [] })
}

function open(record: ShuttleRecord) {
  selected.value = record
  document.addEventListener('keydown', onKeydown)
}

function close() {
  selected.value = null
  document.removeEventListener('keydown', onKeydown)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

async function exportReport() {
  const text = report.value
  if (!text) return
  copying.value = true
  try {
    await copy(text)
    copyMessage.value = '日报已复制到剪贴板'
  } catch {
    // 非安全上下文或没权限时，退回选中文本的方式
    copyMessage.value = '复制失败，请手动全选日报内容'
  } finally {
    copying.value = false
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copyMessage.value = '' }, 3000)
  }
}

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
  loadSummary()
  loadRecent()
})

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.bili-summary {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.date-controls,
.summary-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-controls label {
  color: var(--k-text-light, #999);
  font-size: 13px;
}

.k-date {
  padding: 5px 8px;
  border: 1px solid var(--k-color-border, #dce0e5);
  border-radius: 8px;
  background: var(--k-card-bg, #fff);
  color: var(--k-text-dark, #333);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.k-date:focus {
  border-color: var(--k-color-primary, #527ca6);
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
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 999px;
  padding: 2px 10px;
  background: transparent;
  color: var(--k-text-normal, #555);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.day-chip:hover {
  border-color: var(--k-color-primary, #527ca6);
}

.day-chip.active {
  border-color: var(--k-color-primary, #527ca6);
  background: var(--k-color-primary-fade, #e8eef6);
  color: var(--k-color-primary, #527ca6);
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
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.group-head h3 {
  margin: 0;
  color: var(--k-text-dark, #333);
  font-size: 15px;
  font-weight: 600;
}

.group-tip {
  color: var(--k-text-light, #999);
  font-size: 12px;
}

.report {
  max-height: 420px;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--k-hover-bg, #f6f8fa);
  color: var(--k-text-normal, #555);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-text {
  margin: 8px 0;
  color: var(--k-text-light, #999);
  font-size: 13px;
}

/* —— 照片墙 —— */

.wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}

.cell {
  cursor: pointer;
  border-radius: 10px;
  outline: none;
}

.cell:focus-visible .cover {
  box-shadow: 0 0 0 2px var(--k-color-primary, #527ca6);
}

.cover {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 10px;
  background: linear-gradient(135deg, #6d8bb0, #b0a7c9);
}

.cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.25s ease;
}

.cell:hover .cover img {
  transform: scale(1.04);
}

.cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #6d8bb0, #b0a7c9);
  color: #fff;
  font-size: 34px;
  font-weight: 600;
  opacity: 0.92;
}

.duration {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 0 5px;
  border-radius: 4px;
  background: #000000b3;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.delivery {
  position: absolute;
  left: 6px;
  top: 6px;
  display: flex;
  gap: 4px;
}

.delivery span {
  padding: 0 5px;
  border-radius: 4px;
  background: #000000b3;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
}

.cell-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 6px 2px 0;
  color: var(--k-text-dark, #333);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
}

.cell-meta {
  margin: 2px 2px 0;
  color: var(--k-text-light, #999);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 详情浮层 —— */

.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #00000080;
  backdrop-filter: blur(2px);
}

.detail {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(86vh, 860px);
  overflow: hidden;
  border-radius: 14px;
  background: var(--k-card-bg, #fff);
  color: var(--k-text-dark, #333);
  box-shadow: 0 12px 40px #0000004d;
}

.detail-close {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 2;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: #00000066;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.detail-close:hover {
  background: #00000099;
}

.detail-cover {
  flex: 0 0 auto;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #000;
}

.detail-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.detail-cover .cover-fallback {
  font-size: 52px;
}

.detail-body {
  overflow-y: auto;
  padding: 16px 20px 20px;
}

.detail-title {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
}

.detail-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 0 0 12px;
  font-size: 12px;
}

.detail-facts div {
  display: flex;
  gap: 5px;
}

.detail-facts dt {
  color: var(--k-text-light, #999);
}

.detail-facts dd {
  margin: 0;
  color: var(--k-text-normal, #555);
  font-variant-numeric: tabular-nums;
}

.detail-block {
  margin-top: 14px;
}

.detail-block h4 {
  margin: 0 0 6px;
  color: var(--k-text-light, #999);
  font-size: 12px;
  font-weight: 500;
}

.detail-block p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}

.reason {
  padding: 8px 12px;
  border-left: 3px solid var(--k-color-primary, #527ca6);
  border-radius: 0 8px 8px 0;
  background: var(--k-color-primary-fade, #f2f6fb);
  color: var(--k-text-dark, #333);
}

.content {
  color: var(--k-text-normal, #555);
  white-space: pre-wrap;
}

.detail-block blockquote {
  margin: 0 0 6px;
  padding: 6px 10px;
  border-left: 2px solid var(--k-color-divider, #dce0e5);
  border-radius: 0 6px 6px 0;
  background: var(--k-hover-bg, #f6f8fa);
  color: var(--k-text-normal, #555);
  font-size: 12px;
  line-height: 1.6;
}

.detail-link {
  display: inline-block;
  margin-top: 16px;
  color: var(--k-color-primary, #527ca6);
  font-size: 13px;
}
</style>
