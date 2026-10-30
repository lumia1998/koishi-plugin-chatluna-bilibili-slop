<template>
  <div class="bili-history">
    <section class="k-card actions">
      <div class="actions-head">
        <h3>手动操作</h3>
        <span class="group-tip">排期交给 ChatLuna 触发器，这里只做当场搬一轮</span>
      </div>
      <div class="action-row">
        <button type="button" class="k-button primary" :disabled="shuttleBusy" @click="shuttle">
          {{ shuttleBusy ? '搬运中…' : '立即搬一轮' }}
        </button>
        <button type="button" class="k-button frameless" :disabled="loading" @click="load">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <p v-if="actionMessage" class="action-message">{{ actionMessage }}</p>
      <p class="desc">「立即搬一轮」按当前偏好筛选后按发布方式推送。控制台没有会话，所以只走评论和私信，不推群；群推送请让 ChatLuna 在群里调 `bili_shuttle`。</p>
    </section>

    <section class="k-card timeline-card">
      <div class="actions-head">
        <h3>搬运历史</h3>
        <span class="group-tip">{{ records.length ? `共 ${records.length} 条` : '' }}</span>
      </div>

      <ol v-if="records.length" class="timeline">
        <li v-for="record in records" :key="record.bvid + record.at" class="tl-item">
          <span class="tl-time">{{ moment(record.at) }}</span>
          <span class="tl-axis" aria-hidden="true"><i class="tl-dot" /></span>
          <article
            class="tl-card"
            tabindex="0"
            role="button"
            :aria-label="`查看 ${record.title} 的搬运详情`"
            @click="open(record)"
            @keydown.enter.prevent="open(record)"
            @keydown.space.prevent="open(record)"
          >
            <div class="tl-cover">
              <img v-if="record.pic" :src="record.pic" :alt="record.title" loading="lazy" referrerpolicy="no-referrer">
              <div v-else class="cover-fallback" aria-hidden="true">{{ firstChar(record.title) }}</div>
              <span class="tl-duration">{{ clock(record.duration) }}</span>
            </div>

            <div class="tl-body">
              <a class="tl-title" :href="record.url || `https://www.bilibili.com/video/${record.bvid}`" target="_blank" rel="noreferrer" @click.stop>
                {{ record.title }}
              </a>
              <div class="tl-meta">
                <span>{{ record.author }}</span>
                <span v-if="record.play !== undefined">· {{ views(record.play) }} 播放</span>
                <span v-if="record.comments !== undefined">· {{ views(record.comments) }} 评论</span>
              </div>
              <p class="tl-reason">{{ record.reason || '（这条没有写理由）' }}</p>
              <div class="tl-tags">
                <span v-for="channel in record.delivery" :key="channel" class="tl-tag">{{ CHANNEL_TEXT[channel] || channel }}</span>
                <span v-if="record.score !== undefined" class="tl-tag subtle">得分 {{ Math.round(record.score) }}</span>
              </div>
            </div>
          </article>
        </li>
      </ol>

      <p v-else-if="!loading" class="empty-text">还没有搬运记录。让 ChatLuna 调一次 `bili_shuttle`，或者点上面的「立即搬一轮」。</p>
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
            <div v-if="selected.play !== undefined"><dt>播放</dt><dd>{{ views(selected.play) }}</dd></div>
            <div v-if="selected.comments !== undefined"><dt>评论</dt><dd>{{ views(selected.comments) }}</dd></div>
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

          <a class="detail-link" :href="selected.url || `https://www.bilibili.com/video/${selected.bvid}`" target="_blank" rel="noreferrer">
            在 B站打开 ↗
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { call, clock, moment, views } from './api'
import type { ShuttleRecord } from '../src/types.js'

const emit = defineEmits<{ (event: 'error', message: string): void }>()

const CHANNEL_TEXT: Record<string, string> = {
  comment: '评论',
  dm: '私信',
  group: '群',
}

const records = ref<ShuttleRecord[]>([])
const loading = ref(false)
const shuttleBusy = ref(false)
const actionMessage = ref('')
const selected = ref<ShuttleRecord | null>(null)

function load() {
  loading.value = true
  call('bili-slop/history')
    .then((result) => { records.value = result })
    .catch((err: Error) => emit('error', `读取搬运历史失败：${err.message}`))
    .finally(() => { loading.value = false })
}

function shuttle() {
  if (shuttleBusy.value) return
  shuttleBusy.value = true
  actionMessage.value = ''
  call('bili-slop/shuttle')
    .then(() => {
      actionMessage.value = '这一轮搬完了，结果已写入历史。'
      load()
    })
    .catch((err: Error) => emit('error', `搬运失败：${err.message}`))
    .finally(() => { shuttleBusy.value = false })
}

function firstChar(title: string): string {
  return (title || '?').trim().slice(0, 1) || '?'
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

onMounted(load)
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.bili-history {
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

.actions-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.actions-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.group-tip {
  color: var(--k-text-light, #999);
  font-size: 12px;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.action-message {
  margin: 10px 0 0;
  color: var(--k-color-success, #3ba55e);
  font-size: 13px;
}

.desc {
  margin: 10px 0 0;
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.6;
}

.empty-text {
  margin: 0;
  color: var(--k-text-light, #999);
  font-size: 13px;
}

/* 时间线：左时间 / 中轴线 / 右卡片 */

.timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tl-item {
  display: grid;
  grid-template-columns: 96px 28px 1fr;
  align-items: stretch;
  gap: 0;
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

/* 轴线穿过整行，第一行从圆点开始、最后一行到圆点结束 */
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
  gap: 14px;
  margin: 6px 0 6px 6px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
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
  text-decoration: none;
}

.tl-title:hover { color: var(--k-color-primary, #527ca6); }

.tl-meta {
  color: var(--k-text-light, #999);
  font-size: 12px;
}

.tl-reason {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  color: var(--k-text-normal, #555);
  font-size: 13px;
  line-height: 1.6;
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
  background: var(--k-color-primary-fade, #eef4fb);
  color: var(--k-color-primary, #527ca6);
  font-size: 11px;
}

.tl-tag.subtle {
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-light, #999);
}

/* 详情浮层 */

.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #00000059;
}

.detail {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: 86vh;
  overflow: auto;
  border-radius: 14px;
  background: var(--k-card-bg, #fff);
  box-shadow: 0 12px 40px #0000003d;
}

.detail-close {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 2;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: #00000059;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.detail-cover {
  flex: none;
  height: 240px;
  overflow: hidden;
  background: var(--k-hover-bg, #f3f5f8);
}

.detail-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-body {
  padding: 16px 20px 22px;
}

.detail-title {
  margin: 0 0 12px;
  font-size: 16px;
  line-height: 1.5;
}

.detail-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px 16px;
  margin: 0 0 14px;
}

.detail-facts div {
  display: flex;
  gap: 6px;
  font-size: 12px;
}

.detail-facts dt { color: var(--k-text-light, #999); }
.detail-facts dd { margin: 0; color: var(--k-text-dark, #333); }

.detail-block { margin-bottom: 14px; }

.detail-block h4 {
  margin: 0 0 6px;
  color: var(--k-text-light, #999);
  font-size: 12px;
  font-weight: 600;
}

.reason,
.content {
  margin: 0;
  color: var(--k-text-normal, #444);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.detail-block blockquote {
  margin: 0 0 6px;
  padding: 8px 12px;
  border-left: 3px solid var(--k-color-divider, #dce0e5);
  background: var(--k-hover-bg, #f7f8fa);
  color: var(--k-text-normal, #555);
  font-size: 12px;
  line-height: 1.6;
}

.detail-link {
  display: inline-block;
  margin-top: 4px;
  color: var(--k-color-primary, #527ca6);
  font-size: 13px;
  text-decoration: none;
}

.detail-link:hover { text-decoration: underline; }

@media (max-width: 720px) {
  .tl-item { grid-template-columns: 0 24px 1fr; }
  .tl-time { display: none; }
  .tl-cover { flex-basis: 140px; height: 79px; }
}
</style>
