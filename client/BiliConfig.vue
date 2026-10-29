<template>
  <div class="bili-config">
    <!-- 侧边目录：跟内容区并排，点一下跳到对应分组 -->
    <nav class="side-nav" aria-label="配置分组">
      <button
        v-for="item in NAV"
        :key="item.id"
        type="button"
        class="nav-item"
        :class="{ active: activeSection === item.id }"
        @click="jump(item.id)"
      >
        <span class="nav-dot" aria-hidden="true" />
        {{ item.label }}
      </button>
    </nav>

    <div class="sections">
      <!-- 1. 账号状态 -->
      <section :id="anchor('account')" class="k-card group">
        <div class="group-head">
          <div class="group-title">
            <h3>账号状态</h3>
            <span class="state-pill" :class="status?.loggedIn ? 'ok' : status ? 'off' : 'idle'">
              <span class="state-dot" />
              {{ status ? (status.loggedIn ? '已登录' : '未登录') : '读取中' }}
            </span>
          </div>
        </div>

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

        <div v-if="ledger.length" class="ledger">
          <div class="ledger-head">
            <span>评论台账</span>
            <span class="ledger-count">{{ ledger.length }} 条</span>
          </div>
          <div class="ledger-scroll">
            <table>
              <thead>
                <tr><th>时间</th><th>状态</th><th>视频</th><th>正文</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in ledger" :key="item.bvid + item.at">
                  <td class="cell-time">{{ moment(item.at) }}</td>
                  <td>
                    <span class="tag" :class="stateClass(item.state)">{{ STATE_TEXT[item.state] || item.state }}</span>
                    <span v-if="item.visible" class="tag subtle">{{ VISIBLE_TEXT[item.visible] || item.visible }}</span>
                  </td>
                  <td><a :href="`https://www.bilibili.com/video/${item.bvid}`" target="_blank" rel="noreferrer">{{ item.bvid }}</a></td>
                  <td class="cell-text" :title="item.text">{{ item.text }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 2. 主人 -->
      <section :id="anchor('owner')" class="k-card group">
        <div class="group-head">
          <div class="group-title">
            <h3>主人</h3>
            <span class="group-tip">评论要 @ 的人、私信默认收件人</span>
          </div>
        </div>

        <SettingRow label="主人 UID" desc="评论区的 @ 对象；私信收件人留空时也发给这个 UID。">
          <div class="inline-field">
            <input
              class="k-text"
              type="text"
              inputmode="numeric"
              :value="settings.ownerUid"
              placeholder="12345678"
              @change="emitPatch({ ownerUid: text($event) })"
            >
            <button
              v-if="status?.selfId"
              type="button"
              class="k-button frameless"
              title="把主人设成当前登录的账号"
              @click="emitPatch({ ownerUid: status!.selfId })"
            >用登录账号</button>
          </div>
        </SettingRow>

        <p v-if="!ownerUid" class="hint-warn">还没设置主人 UID：评论区 @ 和默认私信都会失败。</p>
      </section>

      <!-- 3. 偏好设置 -->
      <section :id="anchor('preference')" class="k-card group">
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
          <input class="k-number" type="number" min="0" step="5" :value="settings.minDuration" @change="emitPatch({ minDuration: seconds($event) })">
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

      <!-- 4. 发布方式 -->
      <section :id="anchor('publish')" class="k-card group">
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

      <!-- 5. 互动方式 -->
      <section :id="anchor('interact')" class="k-card group">
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
            <input type="range" min="1" max="30" step="1" :value="settings.commentPerHour" @input="emitPatch({ commentPerHour: integer($event) })">
            <input class="k-number" type="number" min="1" max="30" :value="settings.commentPerHour" @change="emitPatch({ commentPerHour: integer($event) })">
          </div>
        </SettingRow>

        <SettingRow label="额外 @" desc="评论里除了主人还要 @ 的 UID。" block>
          <TagInput :model-value="settings.mentionUids" placeholder="123456" @update:model-value="emitPatch({ mentionUids: $event })" />
        </SettingRow>

        <SettingRow label="私信白名单" desc="允许给这些 UID 发私信；主人始终允许。" block>
          <TagInput :model-value="settings.dmWhitelist" placeholder="123456" @update:model-value="emitPatch({ dmWhitelist: $event })" />
        </SettingRow>
      </section>

      <!-- 6. 解析方式 -->
      <section :id="anchor('parse')" class="k-card group">
        <div class="group-head"><h3>解析方式</h3></div>

        <SettingRow label="优先读原字幕" desc="关掉后直接走降级链。">
          <input type="checkbox" class="k-switch" :checked="settings.preferSubtitle" @change="emitPatch({ preferSubtitle: checked($event) })">
        </SettingRow>

        <SettingRow label="语音转写" desc="没有字幕时调用 Koishi 的 sst 服务（需要先安装并启用 sst）。">
          <input type="checkbox" class="k-switch" :checked="settings.transcribe" @change="emitPatch({ transcribe: checked($event) })">
        </SettingRow>
      </section>

      <!-- 7. 日报 -->
      <section :id="anchor('report')" class="k-card group">
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

      <!-- 8. 高级 -->
      <section :id="anchor('advanced')" class="k-card group">
        <div class="group-head"><h3>高级</h3><span class="group-tip">一般不用改</span></div>

        <SettingRow label="机器人 UID" desc="留空表示用当前已登录账号。">
          <input class="k-text" type="text" inputmode="numeric" :value="settings.selfId" placeholder="留空用当前账号" @change="emitPatch({ selfId: text($event) })">
        </SettingRow>

        <SettingRow label="权限等级" desc="能使用工具的最低 Koishi authority；0–5。">
          <input class="k-number" type="number" min="0" max="5" :value="settings.authority" @change="emitPatch({ authority: integer($event) })">
        </SettingRow>

        <SettingRow label="放行用户" desc="额外允许使用的用户，格式 platform:userId。" block>
          <TagInput :model-value="settings.allowedUsers" placeholder="onebot:123456789" @update:model-value="emitPatch({ allowedUsers: $event })" />
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
      </section>
    </div>

    <!-- 右侧常驻状态栏：登录态、主人、能力开关，滚动时一直可见 -->
    <aside class="status-rail" aria-label="账号概况">
      <section class="k-card rail-card">
        <div class="rail-head">
          <h3>概况</h3>
          <button type="button" class="rail-refresh" :disabled="statusBusy" :title="statusBusy ? '刷新中' : '刷新状态'" @click="loadStatus">
            <span :class="{ spinning: statusBusy }">⟳</span>
          </button>
        </div>

        <div class="rail-list">
          <div class="rail-row">
            <span class="rail-label">登录账号</span>
            <span class="rail-value" :class="{ muted: !status?.loggedIn }">
              {{ status?.nickname || (status?.loggedIn ? '已登录' : status ? '未登录' : '—') }}
              <span v-if="status?.selfId" class="rail-sub">UID {{ status.selfId }}</span>
            </span>
          </div>
          <div class="rail-row">
            <span class="rail-label">主人 UID</span>
            <span class="rail-value" :class="{ muted: !ownerUid }">{{ ownerUid || '未设置' }}</span>
          </div>
          <div class="rail-row">
            <span class="rail-label">凭证刷新</span>
            <span class="rail-value" :class="{ muted: !status?.refreshedAt }">{{ moment(status?.refreshedAt) }}</span>
          </div>
        </div>

        <div v-if="status?.features" class="rail-list rail-features">
          <div v-for="item in featureList" :key="item.label" class="rail-row">
            <span class="rail-label">{{ item.label }}</span>
            <span class="rail-state" :class="item.on ? 'on' : 'off'">
              <span class="rail-dot" />{{ item.on ? '已开启' : '未开启' }}
            </span>
          </div>
        </div>

        <div v-if="status?.lastRun" class="rail-last">
          上次搬运 {{ moment(status.lastRun.at) }} · {{ status.lastRun.picks }} 条
          <span v-if="status.lastRun.errors?.length" class="rail-last-err">
            {{ status.lastRun.errors.length }} 个错误：{{ status.lastRun.errors.slice(0, 2).join('；') }}
          </span>
        </div>
      </section>
    </aside>
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

const props = defineProps<{ settings: Settings }>()
const emit = defineEmits<{
  (event: 'patch', value: Partial<Settings>): void
  (event: 'error', message: string): void
}>()

function emitPatch(value: Partial<Settings>) {
  emit('patch', value)
}

// —— 侧边目录 ——

const NAV = [
    { id: 'account', label: '账号状态' },
    { id: 'owner', label: '主人' },
    { id: 'preference', label: '偏好设置' },
    { id: 'publish', label: '发布方式' },
    { id: 'interact', label: '互动方式' },
    { id: 'parse', label: '解析方式' },
    { id: 'report', label: '日报' },
    { id: 'advanced', label: '高级' },
] as const

type SectionId = typeof NAV[number]['id']

/** DOM id 加前缀，避免和控制台其它页面的 id 撞车 */
function anchor(id: SectionId) {
    return `bili-slop-${id}`
}

const activeSection = ref<SectionId>('account')
let observer: IntersectionObserver | undefined

function jump(id: SectionId) {
    activeSection.value = id
    document.getElementById(anchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

const ownerUid = computed(() => props.settings.ownerUid)

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

/** 台账按时间倒序，最新的在最上面 */
const ledger = computed(() => {
    const list = status.value?.ledger || []
    return [...list].sort((a, b) => String(b.at).localeCompare(String(a.at)))
})

const STATE_TEXT: Record<string, string> = { sent: '已发送', sending: '发送中', unknown: '结果未知' }
const VISIBLE_TEXT: Record<string, string> = { public: '公开可见', pending: '仅登录可见', missing: '未查到' }

function stateClass(state: string) {
    if (state === 'sent') return 'ok'
    if (state === 'unknown') return 'danger'
    return 'subtle'
}

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

const STATE_TEXT_LOGIN: Record<string, string> = {
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
        loginMessage.value = STATE_TEXT_LOGIN.waiting
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
        loginMessage.value = result.message || STATE_TEXT_LOGIN[result.state] || STATE_TEXT_LOGIN.unknown

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

onMounted(() => {
    loadStatus()
    loadModels()

    // 滚动到哪一节，目录就跟到哪一节
    if (typeof IntersectionObserver === 'undefined') return
    observer = new IntersectionObserver((entries) => {
        const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const first = visible[0]
        if (!first) return
        const id = first.target.id.replace('bili-slop-', '') as SectionId
        if (NAV.some((item) => item.id === id)) activeSection.value = id
    }, { rootMargin: '-64px 0px -55% 0px', threshold: 0 })
    for (const item of NAV) {
        const node = document.getElementById(anchor(item.id))
        if (node) observer.observe(node)
    }
})

onBeforeUnmount(() => {
    stopPolling()
    observer?.disconnect()
    observer = undefined
})
</script>

<style scoped>
.bili-config {
  display: flex;
  align-items: flex-start;
  gap: 24px;
}

/* —— 侧边目录 —— */

.side-nav {
  position: sticky;
  top: 16px;
  flex: 0 0 148px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 12px;
  background: var(--k-card-bg, #fff);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--k-text-normal, #555);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background 0.16s, color 0.16s;
}

.nav-item:hover {
  background: var(--k-card-bg, #fff);
  color: var(--k-text-dark, #333);
}

.nav-item.active {
  background: var(--k-card-bg, #fff);
  color: var(--k-color-primary, #527ca6);
  font-weight: 600;
  box-shadow: 0 1px 3px #00000014;
}

.nav-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.35;
  flex: 0 0 auto;
}

.nav-item.active .nav-dot {
  opacity: 1;
}

/* —— 内容区 —— */

.sections {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group {
  padding: 16px 20px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 12px;
  background: var(--k-card-bg, #fff);
  scroll-margin-top: 16px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.group-title {
  display: flex;
  align-items: center;
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

.desc {
  margin: 6px 0 0;
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.6;
}

.warn-text { color: var(--k-color-danger, #e66); }

.hint-warn {
  margin: 10px 0 0;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--k-color-warning-fade, #fdf6ec);
  color: var(--k-color-warning-shade, #a06b1a);
  font-size: 12px;
}

/* —— 账号状态 —— */

.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.6;
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-light, #999);
}

.state-pill.ok { background: var(--k-color-success-fade, #eaf7ee); color: var(--k-color-success-shade, #2f7d47); }
.state-pill.off { background: var(--k-color-danger-fade, #fdecec); color: var(--k-color-danger-shade, #c33); }

.state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
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

.qr-box img { display: block; border-radius: 6px; }

.qr-tip,
.qr-fallback {
  margin: 0;
  color: #666;
  font-size: 12px;
  text-align: center;
}

.qr-fallback a { color: var(--k-color-primary, #527ca6); }

/* 右侧状态栏 */

.status-rail {
  position: sticky;
  top: 16px;
  flex: 0 0 260px;
  min-width: 0;
}

.rail-card {
  padding: 16px 18px;
  border: 1px solid var(--k-color-divider, #dce0e5);
  border-radius: 12px;
  background: var(--k-card-bg, #fff);
}

.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.rail-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--k-text-dark, #2b2f36);
}

.rail-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 8px;
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-normal, #666);
  font-size: 14px;
  cursor: pointer;
}

.rail-refresh:disabled { cursor: default; opacity: 0.6; }

.rail-refresh .spinning { display: inline-block; animation: rail-spin 0.9s linear infinite; }

@keyframes rail-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.rail-list {
  display: flex;
  flex-direction: column;
}

.rail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--k-color-divider-light, #f0f2f5);
}

.rail-list > .rail-row:last-child { border-bottom: none; padding-bottom: 2px; }

.rail-label {
  flex: none;
  color: var(--k-text-normal, #666);
  font-size: 13px;
}

.rail-value {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  min-width: 0;
  color: var(--k-text-dark, #2b2f36);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-value.muted { color: var(--k-text-light, #a6aab2); font-weight: 400; }

.rail-sub {
  color: var(--k-text-light, #999);
  font-size: 11px;
  font-weight: 400;
}

.rail-features {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--k-color-divider-light, #f0f2f5);
}

.rail-features .rail-row { padding: 7px 0; }

.rail-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  font-size: 13px;
  font-weight: 600;
}

.rail-state.on { color: var(--k-color-success, #52c41a); }
.rail-state.off { color: var(--k-text-light, #b0b4bb); }

.rail-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.rail-last {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--k-color-divider-light, #f0f2f5);
  color: var(--k-text-light, #999);
  font-size: 12px;
  line-height: 1.6;
}

.rail-last-err { display: block; color: var(--k-color-danger, #e66); }

/* 评论台账 */

.ledger {
  margin-top: 14px;
  border: 1px solid var(--k-color-divider-light, #f0f2f5);
  border-radius: 10px;
  overflow: hidden;
}

.ledger-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--k-hover-bg, #f7f8fa);
  color: var(--k-text-normal, #555);
  font-size: 12px;
  font-weight: 500;
}

.ledger-count { color: var(--k-text-light, #999); font-weight: 400; }

.ledger-scroll { max-height: 280px; overflow: auto; }

.ledger table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.ledger th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 12px;
  background: var(--k-card-bg, #fff);
  border-bottom: 1px solid var(--k-color-divider-light, #f0f2f5);
  color: var(--k-text-light, #999);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}

.ledger td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--k-color-divider-light, #f0f2f5);
  color: var(--k-text-normal, #555);
  vertical-align: middle;
}

.ledger tr:last-child td { border-bottom: 0; }

.ledger a {
  color: var(--k-color-primary, #527ca6);
  text-decoration: none;
  font-variant-numeric: tabular-nums;
}

.ledger a:hover { text-decoration: underline; }

.cell-time { white-space: nowrap; color: var(--k-text-light, #999); font-variant-numeric: tabular-nums; }

.cell-text {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.7;
  background: var(--k-hover-bg, #f3f5f8);
  color: var(--k-text-light, #999);
  white-space: nowrap;
}

.tag + .tag { margin-left: 4px; }
.tag.ok { background: var(--k-color-success-fade, #eaf7ee); color: var(--k-color-success-shade, #2f7d47); }
.tag.danger { background: var(--k-color-danger-fade, #fdecec); color: var(--k-color-danger-shade, #c33); }

/* —— 表单控件 —— */

.inline-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

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
.k-text:focus { border-color: var(--k-color-primary, #527ca6); }

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

.k-switch:checked { background: var(--k-color-primary, #527ca6); }
.k-switch:checked::after { transform: translateX(18px); }

.number-range {
  display: flex;
  align-items: center;
  gap: 10px;
}

.number-range input[type='range'] {
  width: 140px;
  accent-color: var(--k-color-primary, #527ca6);
}

/* 太窄就放弃右侧栏，状态排到内容上方 */
@media (max-width: 1240px) {
  .bili-config { flex-wrap: wrap; }

  .status-rail {
    position: static;
    flex: 1 1 100%;
    order: -1;
  }

  .rail-card {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0 24px;
  }

  .rail-head { grid-column: 1 / -1; }
  .rail-last { grid-column: 1 / -1; }
}

@media (max-width: 900px) {
  .bili-config { flex-direction: column; }

  .side-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    width: 100%;
    box-sizing: border-box;
  }

  .sections { width: 100%; }
}
</style>
