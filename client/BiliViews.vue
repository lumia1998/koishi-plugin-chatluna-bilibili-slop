<template>
  <div class="bili-views">
    <section class="k-card">
      <div class="views-head">
        <h3>品鉴历史</h3>
        <span class="group-tip">{{ records.length ? `共 ${records.length} 条` : '每次用 bili_video 看视频都会记一条，bili_take 写锐评' }}</span>
        <button type="button" class="k-button frameless refresh" :disabled="loading" @click="load">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>

      <ol v-if="records.length" class="timeline">
        <li v-for="record in records" :key="record.bvid + record.at" class="tl-item">
          <span class="tl-time">{{ moment(record.at) }}</span>
          <span class="tl-axis" aria-hidden="true"><i class="tl-dot" /></span>

          <a class="tl-card" :href="record.url || `https://www.bilibili.com/video/${record.bvid}`" target="_blank" rel="noreferrer">
            <div class="tl-cover">
              <img v-if="record.pic" :src="record.pic" :alt="record.title" loading="lazy" referrerpolicy="no-referrer">
              <div v-else class="cover-fallback" aria-hidden="true">{{ firstChar(record.title) }}</div>
              <span class="tl-duration">{{ clock(record.duration) }}</span>
            </div>

            <div class="tl-body">
              <span class="tl-title">{{ record.title }}</span>
              <div class="tl-meta">
                <span>{{ record.author }}</span>
                <span v-if="record.uid">· UID {{ record.uid }}</span>
              </div>
              <div class="tl-tags">
                <span v-if="record.source" class="tl-tag" :class="sourceClass(record.source)">{{ SOURCE_TEXT[record.source] || record.source }}</span>
                <span class="tl-tag subtle">{{ record.bvid }}</span>
              </div>
            </div>

            <div class="tl-verdict">
              <div v-for="row in verdictRows(record)" :key="row.kind" class="vd-row" :class="[row.kind, { empty: row.empty }]">
                <span class="vd-label">{{ row.label }}</span>
                <p class="vd-text">{{ row.text }}</p>
              </div>
            </div>
          </a>
        </li>
      </ol>

      <p v-else-if="!loading" class="empty-text">
        还没有品鉴记录。让 ChatLuna 看一个视频（`bili_video`）之后，这里会按时间列出来，右边是搬运理由和视频内容。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { call, clock, moment } from './api'
import type { ViewRecord } from '../src/types.js'

const emit = defineEmits<{ (event: 'error', message: string): void }>()

const SOURCE_TEXT: Record<string, string> = {
  subtitle: '原字幕',
  asr: '语音转写',
  summary: 'AI 总结',
  none: '无正文',
}

interface VerdictRow {
  kind: 'reason' | 'content'
  label: string
  text: string
  empty: boolean
}

const records = ref<ViewRecord[]>([])
const loading = ref(false)

function load() {
  loading.value = true
  call('bili-slop/views')
    .then((result) => { records.value = result })
    .catch((err: Error) => emit('error', `读取品鉴历史失败：${err.message}`))
    .finally(() => { loading.value = false })
}

/**
 * 右侧固定两行：搬运理由 → 视频内容。
 * 每张卡都有这两行，没数据时给灰字占位；标签颜色固定（棕 / 绿），
 * 标签列宽由 CSS grid 固定，所以整列的标签和正文纵向对齐。
 */
function verdictRows(record: ViewRecord): VerdictRow[] {
  const reason = (record.reason || '').trim()
  const content = (record.excerpt || record.description || '').trim()

  return [
    reason
      ? { kind: 'reason', label: '搬运理由', text: reason, empty: false }
      : { kind: 'reason', label: '搬运理由', text: '没搬过这条视频，还没有理由。', empty: true },
    content
      ? { kind: 'content', label: '视频内容', text: content, empty: false }
      : { kind: 'content', label: '视频内容', text: '没取到正文，只有标题和简介。', empty: true },
  ]
}

function firstChar(title: string): string {
  return (title || '?').trim().slice(0, 1) || '?'
}

function sourceClass(source: string) {
  if (source === 'subtitle' || source === 'asr') return 'ok'
  if (source === 'none') return 'subtle'
  return ''
}

onMounted(load)
</script>

<style scoped>
.bili-views {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.k-card {
  padding: 16px 20px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 12px;
  background: var(--k-card-bg, #fff);
}

.views-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}

.views-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.group-tip {
  color: var(--k-text-light, #999);
  font-size: 12px;
}

.refresh { margin-left: auto; }

.empty-text {
  margin: 8px 0 0;
  color: var(--k-text-light, #999);
  font-size: 13px;
  line-height: 1.7;
}

/* 时间线 */

.timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tl-item {
  display: grid;
  grid-template-columns: 96px 28px minmax(0, 1fr);
  align-items: stretch;
}

.tl-time {
  padding-top: 16px;
  color: var(--k-text-light, #999);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.tl-axis {
  position: relative;
  display: flex;
  justify-content: center;
}

.tl-axis::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  border-left: 1px dashed var(--k-color-divider, #dce0e5);
}

.tl-item:first-child .tl-axis::before { top: 22px; }
.tl-item:last-child .tl-axis::before { bottom: calc(100% - 22px); }

.tl-dot {
  position: relative;
  z-index: 1;
  width: 9px;
  height: 9px;
  margin-top: 18px;
  border: 2px solid var(--k-color-divider, #dce0e5);
  border-radius: 50%;
  background: var(--k-card-bg, #fff);
}

.tl-item:hover .tl-dot {
  border-color: var(--k-color-primary, #527ca6);
  background: var(--k-color-primary, #527ca6);
}

.tl-card {
  display: flex;
  align-items: stretch;
  gap: 14px;
  margin: 6px 0 6px 6px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  color: inherit;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}

.tl-card:hover,
.tl-card:focus-visible {
  border-color: var(--k-color-divider, #dce0e5);
  background: var(--k-hover-bg, #f7f8fa);
  outline: none;
}

.tl-cover {
  position: relative;
  flex: 0 0 200px;
  height: 113px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--k-hover-bg, #f3f5f8);
}

.tl-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--k-text-light, #bbb);
  font-size: 28px;
  font-weight: 600;
}

.tl-duration {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #000000a6;
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tl-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.tl-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--k-text-dark, #2b2f36);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.tl-card:hover .tl-title { color: var(--k-color-primary, #527ca6); }

.tl-meta {
  color: var(--k-text-light, #999);
  font-size: 12px;
}

.tl-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}

.tl-tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-light, #999);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tl-tag.ok {
  background: var(--k-color-success-fade, #eaf7ee);
  color: var(--k-color-success-shade, #2f7d47);
}

.tl-tag.subtle {
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-light, #aaa);
}

/* 右侧固定行位：锐评 / 搬运理由 / 视频内容。宽度写死，整列左边界才对得齐 */

.tl-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 400px;
  max-width: 42%;
  min-width: 0;
  margin-left: 4px;
  padding: 2px 4px 2px 14px;
  border-left: 1px solid var(--k-color-divider, #dce0e5);
  cursor: inherit;
}

.vd-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
}

.vd-label {
  align-self: start;
  padding-top: 1px;
  color: var(--k-color-primary, #527ca6);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
}

.vd-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  color: var(--k-text-normal, #555);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 标签颜色固定：搬运理由棕、视频内容绿；占位行只把正文调灰 */

.vd-row.reason .vd-label { color: var(--k-color-warning-shade, #a26b13); }
.vd-row.content .vd-label { color: var(--k-color-success-shade, #2f7d47); }

.vd-row.content .vd-text { color: var(--k-text-light, #888); }
.vd-row.empty .vd-text { color: var(--k-text-light, #bbb); }

@media (max-width: 1000px) {
  .tl-card { flex-wrap: wrap; }
  .tl-verdict {
    flex: 1 1 100%;
    max-width: none;
    margin-left: 0;
    padding: 8px 0 0;
    border-left: 0;
    border-top: 1px solid var(--k-color-divider, #dce0e5);
  }
}

@media (max-width: 720px) {
  .tl-item { grid-template-columns: 0 24px minmax(0, 1fr); }
  .tl-time { display: none; }
  .tl-cover { flex-basis: 140px; height: 79px; }
}
</style>
