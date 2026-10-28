<template>
  <div class="bili-config">
    <!-- 1. 账号状态 -->
    <section class="k-card group">
      <div class="group-head">
        <h3>账号状态</h3>
        <button type="button" class="k-button" :disabled="statusBusy" @click="loadStatus">
          {{ statusBusy ? '刷新中…' : '刷新' }}
        </button>
      </div>

      <div class="account-line">
        <span class="dot" :class="status?.loggedIn ? 'ok' : 'off'" />
        <strong>{{ status ? (status.loggedIn ? '已登录' : '未登录') : '读取中…' }}</strong>
        <span v-if="status?.nickname" class="account-name">{{ status.nickname }}</span>
      </div>

      <dl class="facts">
        <div><dt>UID</dt><dd>{{ status?.selfId || '—' }}</dd></div>
        <div><dt>主人 UID</dt><dd>{{ status?.ownerUid || '未设置' }}</dd></div>
        <div><dt>凭证刷新</dt><dd>{{ moment(status?.refreshedAt) }}</dd></div>
      </dl>

      <p class="desc">用手机 B站扫码登录；凭证只保存在服务端，不会回传给页面。</p>

      <div class="login-row">
        <button type="button" class="k-button primary" :disabled="loginBusy" @click="login">
          {{ loginBusy ? '等待扫码…' : (status?.loggedIn ? '重新扫码登录' : '扫码登录') }}
        </button>
        <button v-if="qr" type="button" class="k-button" @click="cancelLogin">取消</button>
        <span v-if="loginMessage" class="login-message" :class="loginState">{{ loginMessage }}</span>
      </div>

      <div v-if="qr" class="qr-box">
        <img v-if="qrImage" :src="qrImage" alt="B站扫码登录二维码" width="180" height="180">
        <p v-else class="qr-fallback">二维码生成失败，<a :href="qr.url" target="_blank" rel="noreferrer">点这里打开登录页</a></p>
        <p class="qr-tip">用 B站 App 扫描二维码，在手机上确认登录。</p>
      </div>

      <div v-if="status?.features" class="feature-badges">
        <span v-for="item in featureList" :key="item.label" class="k-badge" :class="item.on ? 'success' : ''">
          {{ item.label }}{{ item.on ? '已开' : '关' }}
        </span>
      </div>

      <div v-if="status?.lastRun" class="last-run">
        上次搬运：{{ moment(status.lastRun.at) }} · {{ status.lastRun.picks }} 条
        <span v-if="status.lastRun.errors?.length" class="last-run-errors">（{{ status.lastRun.errors.length }} 个错误：{{ status.lastRun.errors.slice(0, 2).join('；') }}）</span>
      </div>

      <details v-if="status?.ledger?.length" class="ledger">
        <summary>评论台账 {{ status.ledger.length }} 条</summary>
        <ul>
          <li v-for="item in status.ledger.slice(0, 30)" :key="item.bvid + item.at">
            <code>{{ item.bvid }}</code>
            <span class="ledger-state">{{ item.state }}{{ item.visible ? ` / ${item.visible}` : '' }}</span>
            <span class="ledger-text">{{ item.text }}</span>
          </li>
        </ul>
      </details>
    </section>

    <!-- 2. 偏好设置 -->
    <section class="k-card group">
      <div class="group-head"><h3>偏好设置</h3></div>

      <SettingRow label="搜索关键词" desc="留空时用内置的赤石词表；每行一个或多个，回车添加。" block>
        <TagInput :model-value="settings.keywords" placeholder="赤石视频" @update:model-value="emitPatch({ keywords: $event })" />
      </SettingRow>

      <SettingRow label="追踪作者" desc="UID 或精确昵称。" block>
        <TagInput :model-value="settings.targetAuthors" placeholder="作者昵称" @update:model-value="emitPatch({ targetAuthors: $event })" />
      </SettingRow>

      <SettingRow label="视频分区" desc="按 tname 精确匹配；留空表示不限。" block>
        <TagInput :model-value="settings.videoTypes" placeholder="鬼畜" @update:model-value="emitPatch({ videoTypes: $event })" />
      </SettingRow>

      <SettingRow label="屏蔽词" desc="标题或简介命中这些词就直接丢弃。" block>
        <TagInput :model-value="settings.blockKeywords" placeholder="广告" @update:model-value="emitPatch({ blockKeywords: $event })" />
      </SettingRow>

      <SettingRow label="最短时长" desc="低于这个秒数的视频不要；0 表示不限。">
        <input
          class="k-number"
          type="number"
          min="0"
          step="5"
          :value="settings.minDuration"
          @change="emitPatch({ minDuration: seconds($event) })"
        >
      </SettingRow>

      <SettingRow label="最长时长" desc="超过这个秒数的视频不要；0 表示不限。">
        <input
          class="k-number"
          type="number"
          min="0"
          step="60"
          :value="settings.maxDuration || ''"
          placeholder="不限"
          @change="emitPatch({ maxDuration: seconds($event) })"
        >
      </SettingRow>
    </section>

    <!-- 3. 发布方式 -->
    <section class="k-card group">
      <div class="group-head"><h3>发布方式</h3><span class="group-tip">三种方式互相独立，可多选</span></div>

      <SettingRow label="评论区 @" desc="在视频评论区 @ 主人，公开可见。">
        <input type="checkbox" class="k-switch" :checked="settings.publishComment" @change="emitPatch({ publishComment: checked($event) })">
      </SettingRow>

      <SettingRow label="B站私信" desc="通过 B站私信推送给你。">
        <input type="checkbox" class="k-switch" :checked="settings.publishDm" @change="emitPatch({ publishDm: checked($event) })">
      </SettingRow>

      <SettingRow label="Koishi 群推送" desc="用 ctx.broadcast 把卡片发到群组。">
        <input type="checkbox" class="k-switch" :checked="settings.publishGroup" @change="emitPatch({ publishGroup: checked($event) })">
      </SettingRow>

      <SettingRow v-if="settings.publishGroup" label="群组频道" desc="格式 platform:channelId。" block>
        <TagInput :model-value="settings.channels" placeholder="onebot:123456789" @update:model-value="emitPatch({ channels: $event })" />
      </SettingRow>

      <SettingRow v-if="settings.publishDm" label="私信收件人" desc="留空则发给主人 UID。">
        <input
          class="k-text"
          type="text"
          inputmode="numeric"
          :value="settings.dmUid"
          placeholder="留空用主人 UID"
          @change="emitPatch({ dmUid: text($event) })"
        >
      </SettingRow>
    </section>

    <!-- 4. 互动方式 -->
    <section class="k-card group">
      <div class="group-head"><h3>互动方式</h3><span class="group-tip">三条独立开关</span></div>

      <SettingRow label="在视频下评论" desc="发表一级评论。">
        <input type="checkbox" class="k-switch" :checked="settings.allowComment" @change="emitPatch({ allowComment: checked($event) })">
      </SettingRow>

      <SettingRow label="回复一级评论" desc="回复楼层的作者。">
        <input type="checkbox" class="k-switch" :checked="settings.allowReplyRoot" @change="emitPatch({ allowReplyRoot: checked($event) })">
      </SettingRow>

      <SettingRow label="回复楼中楼" desc="回复二级评论。">
        <input type="checkbox" class="k-switch" :checked="settings.allowReplySub" @change="emitPatch({ allowReplySub: checked($event) })">
      </SettingRow>

      <SettingRow label="每小时评论上限" desc="一级评论和回复合计；1–30。">
        <div class="number-range">
          <input
            type="range"
            min="1"
            max="30"
            step="1"
            :value="settings.commentPerHour"
            @input="emitPatch({ commentPerHour: integer($event) })"
          >
          <input
            class="k-number"
            type="number"
            min="1"
            max="30"
            :value="settings.commentPerHour"
            @change="emitPatch({ commentPerHour: integer($event) })"
          >
        </div>
      </SettingRow>

      <SettingRow label="额外 @" desc="评论里除了主人还要 @ 的 UID。" block>
        <TagInput :model-value="settings.mentionUids" placeholder="123456" @update:model-value="emitPatch({ mentionUids: $event })" />
      </SettingRow>

      <SettingRow label="私信白名单" desc="允许给这些 UID 发私信；主人始终允许。" block>
        <TagInput :model-value="settings.dmWhitelist" placeholder="123456" @update:model-value="emitPatch({ dmWhitelist: $event })" />
      </SettingRow>
    </section>

    <!-- 5. 解析方式 -->
    <section class="k-card group">
      <div class="group-head"><h3>解析方式</h3></div>

      <SettingRow label="优先读原字幕" desc="关掉后直接走降级链。">
        <input type="checkbox" class="k-switch" :checked="settings.preferSubtitle" @change="emitPatch({ preferSubtitle: checked($event) })">
      </SettingRow>

      <SettingRow label="语音转写" desc="没有字幕时调用 Koishi 的 sst 服务（需要先安装并启用 sst）。">
        <input type="checkbox" class="k-switch" :checked="settings.transcribe" @change="emitPatch({ transcribe: checked($event) })">
      </SettingRow>
    </section>

    <!-- 6. 日报 -->
    <section class="k-card group">
      <div class="group-head">
        <h3>日报</h3>
        <span class="group-tip">总结页里「AI 写日报」用的模型</span>
      </div>

      <SettingRow label="日报模型" desc="模型列表来自 ChatLuna；选「不用模型」时日报只是按记录拼出的清单。">
        <select class="k-select" :value="settings.summaryModel" @change="emitPatch({ summaryModel: select($event) })">
          <option value="">不用模型（只列清单）</option>
          <option v-for="item in models" :key="item.name" :value="item.name">{{ item.name }}</option>
        </select>
      </SettingRow>

      <p v-if="modelsError" class="desc warn-text">{{ modelsError }}</p>
      <p v-else-if="models.length === 0" class="desc">
        没读到已加载的模型。先去 ChatLuna 里配好平台和 Key，再回来刷新这一页。
      </p>
    </section>

    <!-- 7. 手动操作（高级之前，方便随手点） -->
    <section class="k-card group">
      <div class="group-head"><h3>手动操作</h3></div>
      <div class="action-row">
        <button type="button" class="k-button primary" :disabled="shuttleBusy" @click="shuttle">
          {{ shuttleBusy ? '搬运中…' : '立即搬一轮' }}
        </button>
        <button type="button" class="k-button" :disabled="verifyBusy" @click="verify">
          {{ verifyBusy ? '复核中…' : '复核评论' }}
        </button>
      </div>
      <p v-if="actionMessage" class="action-message">{{ actionMessage }}</p>
      <p class="desc">「立即搬一轮」按当前偏好筛选后按发布方式推送；「复核评论」重新检查之前发出去的评论是否还在。</p>
    </section>

    <!-- 6. 高级 -->
    <details class="k-card group advanced">
      <summary class="group-head">
        <h3>高级</h3>
        <span class="group-tip">一般不用改</span>
      </summary>

      <div class="advanced-body">
        <SettingRow label="主人 UID" desc="评论 @ 的对象、私信默认收件人。">
          <input class="k-text" type="text" inputmode="numeric" :value="settings.ownerUid" placeholder="12345678" @change="emitPatch({ ownerUid: text($event) })">
        </SettingRow>

        <SettingRow label="机器人 UID" desc="留空表示用当前已登录账号。">
          <input class="k-text" type="text" inputmode="numeric" :value="settings.selfId" placeholder="留空用当前账号" @change="emitPatch({ selfId: text($event) })">
        </SettingRow>

        <SettingRow label="权限等级" desc="能使用工具的最低 Koishi authority；0–5。">
          <input class="k-number" type="number" min="0" max="5" :value="settings.authority" @change="emitPatch({ authority: integer($event) })">
        </SettingRow>

        <SettingRow label="放行用户" desc="额外允许使用的用户，格式 platform:userId。" block>
          <TagInput :model-value="settings.allowedUsers" placeholder="onebot:123456789" @update:model-value="emitPatch({ allowedUsers: $event })" />
        </SettingRow>

        <SettingRow label="定时搬运" desc="每天自动搬运的时刻，HH:MM；留空表示不定时。" block>
          <TagInput :model-value="settings.pushTimes" placeholder="12:00" @update:model-value="emitPatch({ pushTimes: $event })" />
        </SettingRow>

        <SettingRow label="每轮条数" desc="每次最多搬几条；1–10。">
          <input class="k-number" type="number" min="1" max="10" :value="settings.perRun" @change="emitPatch({ perRun: integer($event) })">
        </SettingRow>

        <SettingRow label="收藏夹 ID" desc="自动收藏用的收藏夹；0 表示不收藏。">
          <input class="k-number" type="number" min="0" :value="settings.favFolderId || ''" placeholder="不收藏" @change="emitPatch({ favFolderId: seconds($event) })">
        </SettingRow>

        <SettingRow label="编造诱饵" desc="允许模型在评论里写视频里不存在的内容。风险自负。">
          <input type="checkbox" class="k-switch" :checked="settings.bait" @change="emitPatch({ bait: checked($event) })">
        </SettingRow>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import SettingRow from './SettingRow.vue'
import TagInput from './TagInput.vue'
import { call, moment } from './api'
import type { ConsoleStatus, LoginPoll, ReportModel } from './api'
import type { Settings } from '../src/settings.js'

defineProps<{ settings: Settings }>()
const emit = defineEmits<{
  (event: 'patch', value: Partial<Settings>): void
  (event: 'error', message: string): void
}>()

function emitPatch(value: Partial<Settings>) {
  emit('patch', value)
}

// —— 表单取值：控件给的是 string，这里统一清洗 ——

function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}

function text(event: Event): string {
  return (event.target as HTMLInputElement).value.trim()
}

function integer(event: Event): number {
  const value = Math.round(Number((event.target as HTMLInputElement).value))
  return Number.isFinite(value) ? value : 0
}

/** 秒数、收藏夹 ID 这类非负数；空串按 0 处理 */
function seconds(event: Event): number {
  return Math.max(0, integer(event))
}

/** 下拉框：空串表示「不用模型」 */
function select(event: Event): string {
  return (event.target as HTMLSelectElement).value
}

// —— 日报模型 ——

const models = ref<ReportModel[]>([])
const modelsError = ref('')

function loadModels() {
  modelsError.value = ''
  call('bili-slop/models')
    .then((result) => { models.value = result.models || [] })
    .catch((err: Error) => {
      models.value = []
      modelsError.value = `读取模型列表失败：${err.message}`
    })
}

// —— 账号状态 ——

const status = ref<ConsoleStatus | null>(null)
const statusBusy = ref(false)

const featureList = computed(() => {
  const features = status.value?.features
  if (!features) return []
  return [
    { label: '评论', on: features.comment },
    { label: '回楼层', on: features.replyRoot },
    { label: '回楼中楼', on: features.replySub },
    { label: '私信', on: features.dm },
    { label: '转写', on: features.transcribe },
    { label: '搬运', on: features.shuttle },
  ]
})

function loadStatus() {
  statusBusy.value = true
  call('bili-slop/status')
    .then((value) => { status.value = value })
    .catch((err: Error) => emit('error', `读取账号状态失败：${err.message}`))
    .finally(() => { statusBusy.value = false })
}

// —— 扫码登录 ——

const qr = ref<{ key: string, url: string } | null>(null)
const qrImage = ref('')
const loginBusy = ref(false)
const loginState = ref<LoginPoll['state'] | ''>('')
const loginMessage = ref('')

let pollTimer: ReturnType<typeof setTimeout> | undefined
let polls = 0

const POLL_INTERVAL = 2000
/** 二维码 180 秒过期，轮询次数留点余量 */
const MAX_POLLS = 90

const STATE_TEXT: Record<string, string> = {
  waiting: '等待扫码…',
  scanned: '已扫码，请在手机上确认登录',
  expired: '二维码已过期，请重新获取',
  ok: '登录成功，凭证已保存',
  unknown: '扫码状态异常',
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = undefined
}

async function login() {
  stopPolling()
  polls = 0
  loginBusy.value = true
  loginState.value = ''
  loginMessage.value = '正在获取二维码…'
  qr.value = null
  qrImage.value = ''

  try {
    const ticket = await call('bili-slop/login/start')
    qr.value = ticket
    loginMessage.value = STATE_TEXT.waiting
    loginState.value = 'waiting'
    qrImage.value = await QRCode.toDataURL(ticket.url, {
      margin: 1, width: 360, color: { dark: '#000000', light: '#ffffff' },
    })
    schedulePoll()
  } catch (err) {
    loginBusy.value = false
    loginState.value = 'unknown'
    loginMessage.value = `获取二维码失败：${(err as Error).message}`
  }
}

function schedulePoll() {
  stopPolling()
  pollTimer = setTimeout(poll, POLL_INTERVAL)
}

async function poll() {
  const ticket = qr.value
  if (!ticket) return
  if (++polls > MAX_POLLS) {
    cancelLogin()
    loginState.value = 'expired'
    loginMessage.value = '二维码已过期，请重新获取'
    return
  }

  try {
    const result = await call('bili-slop/login/poll', { key: ticket.key })
    loginState.value = result.state
    loginMessage.value = result.message || STATE_TEXT[result.state] || STATE_TEXT.unknown

    if (result.state === 'ok') {
      stopPolling()
      loginBusy.value = false
      qr.value = null
      qrImage.value = ''
      loadStatus()
      return
    }
    if (result.state === 'expired') {
      stopPolling()
      loginBusy.value = false
      return
    }
  } catch (err) {
    loginState.value = 'unknown'
    loginMessage.value = `轮询失败：${(err as Error).message}`
  }

  schedulePoll()
}

function cancelLogin() {
  stopPolling()
  loginBusy.value = false
  qr.value = null
  qrImage.value = ''
}

// —— 手动操作 ——

const shuttleBusy = ref(false)
const verifyBusy = ref(false)
const actionMessage = ref('')

function shuttle() {
  shuttleBusy.value = true
  actionMessage.value = ''
  call('bili-slop/shuttle')
    .then(() => {
      actionMessage.value = '已触发一轮搬运，结果会出现在「总结」页。'
      loadStatus()
    })
    .catch((err: Error) => emit('error', `触发搬运失败：${err.message}`))
    .finally(() => { shuttleBusy.value = false })
}

function verify() {
  verifyBusy.value = true
  actionMessage.value = ''
  call('bili-slop/verify')
    .then((result) => {
      const summary = result && typeof result === 'object' ? JSON.stringify(result) : ''
      actionMessage.value = summary ? `复核完成：${summary}` : '复核完成。'
      loadStatus()
    })
    .catch((err: Error) => emit('error', `复核失败：${err.message}`))
    .finally(() => { verifyBusy.value = false })
}

onMounted(() => {
  loadStatus()
  loadModels()
})

onBeforeUnmount(stopPolling)
</script>

<style scoped>
.bili-config {
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

.desc {
  margin: 6px 0 0;
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.6;
}

/* —— 账号状态 —— */

.account-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.account-name {
  color: var(--k-text-normal, #555);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--k-text-light, #999);
}

.dot.ok { background: var(--k-color-success, #3ba55e); }
.dot.off { background: var(--k-color-danger, #e66); }

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 10px 0 0;
}

.facts div {
  display: flex;
  gap: 6px;
  font-size: 13px;
}

.facts dt {
  color: var(--k-text-light, #999);
}

.facts dd {
  margin: 0;
  color: var(--k-text-normal, #555);
  font-variant-numeric: tabular-nums;
}

.login-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.login-message {
  color: var(--k-text-normal, #555);
  font-size: 13px;
}

.login-message.ok { color: var(--k-color-success, #3ba55e); }
.login-message.expired,
.login-message.unknown { color: var(--k-color-danger, #e66); }
.login-message.scanned { color: var(--k-color-warning, #e6a23c); }

.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--k-color-divider, #dce0e5);
}

.qr-box img {
  display: block;
  border-radius: 6px;
}

.qr-tip,
.qr-fallback {
  margin: 0;
  color: #666;
  font-size: 12px;
  text-align: center;
}

.qr-fallback a {
  color: var(--k-color-primary, #527ca6);
}

.feature-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.last-run {
  margin-top: 10px;
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.6;
}

.last-run-errors {
  color: var(--k-color-danger, #e66);
}

.ledger {
  margin-top: 10px;
  font-size: 12px;
}

.ledger summary {
  color: var(--k-text-normal, #555);
  cursor: pointer;
}

.ledger ul {
  max-height: 240px;
  overflow-y: auto;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.ledger li {
  display: flex;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--k-color-divider-light, #f0f2f5);
  color: var(--k-text-light, #999);
}

.ledger li code {
  color: var(--k-text-normal, #555);
}

.ledger-state {
  flex: 0 0 auto;
}

.ledger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 表单控件 —— */

.k-number {
  width: 96px;
  padding: 5px 8px;
  border: 1px solid var(--k-color-border, #dce0e5);
  border-radius: 8px;
  background: var(--k-card-bg, #fff);
  color: var(--k-text-dark, #333);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.k-text {
  width: 180px;
  padding: 5px 8px;
  border: 1px solid var(--k-color-border, #dce0e5);
  border-radius: 8px;
  background: var(--k-card-bg, #fff);
  color: var(--k-text-dark, #333);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.k-number:focus,
.k-text:focus {
  border-color: var(--k-color-primary, #527ca6);
}

.k-switch {
  width: 38px;
  height: 20px;
  appearance: none;
  border-radius: 999px;
  background: var(--k-color-border, #d0d5dd);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex: 0 0 auto;
}

.k-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.k-switch:checked {
  background: var(--k-color-primary, #527ca6);
}

.k-switch:checked::after {
  transform: translateX(18px);
}

.number-range {
  display: flex;
  align-items: center;
  gap: 10px;
}

.number-range input[type='range'] {
  width: 140px;
  accent-color: var(--k-color-primary, #527ca6);
}

/* —— 手动操作 / 高级 —— */

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.action-message {
  margin: 10px 0 0;
  color: var(--k-text-normal, #555);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-all;
}

.advanced {
  padding: 16px 20px;
}

.advanced > summary {
  margin: 0;
  cursor: pointer;
  list-style: none;
}

.advanced > summary::-webkit-details-marker {
  display: none;
}

.advanced[open] > summary {
  margin-bottom: 8px;
}
</style>
