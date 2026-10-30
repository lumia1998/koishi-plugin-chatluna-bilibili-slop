<template>
  <div class="bili-interact">
    <section class="k-card group">
      <div class="group-head">
        <div class="head-title">
          <h3>互动记录</h3>
          <span class="group-tip">{{ items.length ? `共 ${items.length} 条` : '还没有互动' }}</span>
        </div>
        <div class="head-actions">
          <button type="button" class="k-button frameless" :disabled="verifyBusy" title="匿名复核之前发出去的评论现在还看不看得见" @click="verify">
            {{ verifyBusy ? '复核中…' : '复核评论' }}
          </button>
          <button type="button" class="k-button frameless" :disabled="loading" @click="load">
            {{ loading ? '刷新中…' : '刷新' }}
          </button>
        </div>
      </div>

      <p class="desc">
        按时间列出你和观众的互动：你评论里 @ 了谁、谁在视频或楼中楼里 @ 了你、楼中楼里谁回复了你、私信来回。
        数据来自评论台账、收件箱和私信记录，只读，不在这里改配置。
      </p>
      <p v-if="message" class="action-message">{{ message }}</p>

      <ol v-if="items.length" class="timeline">
        <li v-for="item in items" :key="item.id" class="tl-item">
          <span class="tl-time">{{ moment(item.at) }}</span>
          <span class="tl-axis" aria-hidden="true"><i class="tl-dot" :class="item.direction" /></span>

          <div class="tl-card">
            <a
              v-if="item.bvid"
              class="tl-video"
              :href="`https://www.bilibili.com/video/${item.bvid}`"
              target="_blank"
              rel="noreferrer"
            >
              <span class="video-title">{{ item.title || item.bvid }}</span>
              <span class="video-meta">{{ item.bvid }}</span>
            </a>
            <div v-else class="tl-video static">
              <span class="video-title">私信</span>
              <span class="video-meta">不关联视频</span>
            </div>

            <div class="tl-event">
              <div class="ev-head">
                <span class="ev-tag" :class="item.direction">{{ kindText(item) }}</span>
                <span v-if="peerText(item)" class="ev-peer">{{ peerText(item) }}</span>
                <span v-if="item.state" class="ev-state" :class="stateClass(item.state)">{{ STATE_TEXT[item.state] || item.state }}</span>
                <span v-if="item.visible" class="ev-state subtle">{{ VISIBLE_TEXT[item.visible] || item.visible }}</span>
              </div>
              <p class="ev-text">{{ item.text }}</p>
            </div>
          </div>
        </li>
      </ol>

      <p v-else-if="!loading" class="empty-text">
        还没有互动记录。让 ChatLuna 用 `bili_inbox` 读一次消息或回一次评论，这里就会按时间列出来。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { call, moment } from './api'
import type { InteractionItem } from './api'

const emit = defineEmits<{ (event: 'error', message: string): void }>()

const STATE_TEXT: Record<string, string> = { sent: '已发送', sending: '发送中', unknown: '结果未知' }
const VISIBLE_TEXT: Record<string, string> = { public: '公开可见', pending: '仅登录可见', missing: '未查到' }

const KIND_TEXT: Record<string, string> = {
  'out:comment': '你评论',
  'out:reply': '你回复楼层',
  'out:thread': '楼中楼回复',
  'out:at': '你 @ 了人',
  'out:dm': '你发了私信',
  'in:at': '有人 @ 了你',
  'in:reply': '有人回复了你',
  'in:thread': '楼中楼有人回复你',
  'in:dm': '收到私信',
  'in:comment': '视频评论',
}

const items = ref<InteractionItem[]>([])
const loading = ref(false)
const verifyBusy = ref(false)
const message = ref('')

function load() {
  loading.value = true
  call('bili-slop/interactions')
    .then((result) => { items.value = result })
    .catch((err: Error) => emit('error', `读取互动记录失败：${err.message}`))
    .finally(() => { loading.value = false })
}

/** @ 的是谁 / 回复的是谁 / 谁发来的 */
function peerText(item: InteractionItem): string {
  const who = item.peerName || (item.peerUid ? `UID ${item.peerUid}` : '')
  if (!who) return ''
  if (item.direction === 'in') return `来自 ${who}`
  if (item.kind === 'comment') return `@ ${who}`
  if (item.kind === 'dm') return `发给 ${who}`
  return `回复 ${who}`
}

function kindText(item: InteractionItem): string {
  return KIND_TEXT[`${item.direction}:${item.kind}`] || item.kind
}

function stateClass(state: string) {
  if (state === 'sent') return 'ok'
  if (state === 'unknown') return 'danger'
  return 'subtle'
}

function verify() {
  if (verifyBusy.value) return
  verifyBusy.value = true
  message.value = ''
  call('bili-slop/verify')
    .then(() => {
      message.value = '复核完成，可见性标签已更新。'
      load()
    })
    .catch((err: Error) => emit('error', `复核失败：${err.message}`))
    .finally(() => { verifyBusy.value = false })
}

onMounted(load)
</script>

<style scoped>
.bili-interact {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group {
  padding: 16px 20px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 12px;
  background: var(--k-card-bg, #fff);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.head-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
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

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.desc {
  margin: 6px 0 0;
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.6;
}

.action-message {
  margin: 10px 0 0;
  color: var(--k-color-success-shade, #2f7d47);
  font-size: 12px;
}

.empty-text {
  margin: 14px 0 0;
  color: var(--k-text-light, #999);
  font-size: 13px;
  line-height: 1.7;
}

/* 时间线：左侧视频，右侧互动 */

.timeline {
  margin: 10px 0 0;
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

.tl-dot.out { border-color: var(--k-color-primary, #527ca6); }
.tl-dot.in { border-color: var(--k-color-success, #3ba55e); }

.tl-item:hover .tl-dot.out { background: var(--k-color-primary, #527ca6); }
.tl-item:hover .tl-dot.in { background: var(--k-color-success, #3ba55e); }

.tl-card {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 6px 0 6px 6px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  transition: background 0.15s, border-color 0.15s;
}

.tl-card:hover {
  border-color: var(--k-color-divider, #dce0e5);
  background: var(--k-hover-bg, #f7f8fa);
}

/* 左：是哪条视频 */

.tl-video {
  display: flex;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  flex: 0 0 300px;
  min-width: 0;
  padding-right: 14px;
  margin-right: 14px;
  border-right: 1px solid var(--k-color-divider, #dce0e5);
  color: inherit;
  text-decoration: none;
}

.tl-video.static { cursor: default; }

.video-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--k-text-dark, #2b2f36);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.tl-video:hover .video-title { color: var(--k-color-primary, #527ca6); }

.video-meta {
  color: var(--k-text-light, #999);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* 右：发生了什么 */

.tl-event {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  justify-content: center;
}

.ev-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.ev-tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-light, #999);
  font-size: 11px;
  white-space: nowrap;
}

.ev-tag.out {
  background: color-mix(in srgb, var(--k-color-primary, #527ca6) 12%, transparent);
  color: var(--k-color-primary, #527ca6);
}

.ev-tag.in {
  background: var(--k-color-success-fade, #eaf7ee);
  color: var(--k-color-success-shade, #2f7d47);
}

.ev-peer {
  color: var(--k-text-normal, #555);
  font-size: 12px;
  font-weight: 600;
}

.ev-state {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-light, #999);
  font-size: 11px;
  white-space: nowrap;
}

.ev-state.ok { background: var(--k-color-success-fade, #eaf7ee); color: var(--k-color-success-shade, #2f7d47); }
.ev-state.danger { background: var(--k-color-danger-fade, #fdecec); color: var(--k-color-danger-shade, #c33); }

.ev-text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  color: var(--k-text-normal, #555);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1000px) {
  .tl-card { flex-wrap: wrap; }

  .tl-video {
    flex: 1 1 100%;
    padding: 0 0 8px;
    margin: 0 0 8px;
    border-right: 0;
    border-bottom: 1px solid var(--k-color-divider, #dce0e5);
  }
}

@media (max-width: 720px) {
  .tl-item { grid-template-columns: 0 24px minmax(0, 1fr); }
  .tl-time { display: none; }
}
</style>
