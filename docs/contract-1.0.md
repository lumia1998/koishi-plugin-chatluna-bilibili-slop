# 1.0 契约（先定死，再并行实现）

本文件是并行开发的**唯一真源**。所有 agent 必须按这里的签名编码，不得自行改名。

---

## 1. 文件归属（禁止越界修改）

| 归属 | 文件 |
| --- | --- |
| 主控（已定稿） | `src/settings.ts`、`src/config.ts`、`src/types.ts`、`src/store.ts` |
| Agent A | `src/bili.ts`、`src/api.ts` |
| Agent B | `src/service.ts` |
| Agent C | `src/publish.ts`（新建）、`src/summary.ts`（新建） |
| Agent D | `src/console.ts`（新建）、`client/**` |
| 主控（最后接线） | `src/index.ts`、`package.json`、`tests/**`、`README.md` |

---

## 2. 配置

配置模型在 `src/settings.ts` 的 `Settings` / `SettingsStore`。**ChatLuna 原生配置页保持空 Schema。**
运行时通过 `settingsStore.value` 读配置；写入只经由控制台 RPC。

`Config` 类型 = `Settings`（`src/config.ts` 已导出别名）。

---

## 3. 数据

`src/types.ts` 已新增：`VideoStats`、`ShuttleRecord`、`InboxItem`；`State.version = 3`，新增 `shuttles`。

`State.shuttles` 键为 `${bvid}`（同一视频只保留最后一次搬运）。

---

## 4. Api 层新增方法（Agent A 实现，B/C/D 按此签名调用）

```ts
class Api {
  /** 视频统计：点赞/投币/收藏/分享/弹幕 */
  stats(item: Video): Promise<VideoStats>

  /** 弹幕（前 limit 条，按时间排序） */
  danmaku(item: Video, limit?: number): Promise<{ time: number, text: string }[]>

  /** 首页推荐流（需登录；ps 条） */
  recommend(ps?: number): Promise<Video[]>

  /** 收藏夹列表 */
  favoriteFolders(): Promise<{ id: number, title: string, count: number }[]>

  /** 指定视频是否已在某收藏夹 */
  inFavorite(item: Video, folderId: number): Promise<boolean>

  /** 用户统计：粉丝数、关注数、投稿数 */
  userStat(uid: string): Promise<{ fans: number, following: number, videos: number }>

  /** 收到的 @ 与回复（最近 limit 条） */
  inbox(limit?: number): Promise<InboxItem[]>

  /** 未读私信数 */
  unread(): Promise<number>
}
```

上述方法在 `NativeBili`（`src/bili.ts`）里实现，`api.ts` 只做归一化与转发。

---

## 5. Service 层（Agent B）

`Service` 保留现有方法名，新增/改造如下（供 `src/index.ts` 注册工具时调用）：

```ts
class Service {
  video(api, input, offset?): Promise<VideoResult>            // 已有，补 stats/danmaku 字段
  shuttle(api, opts): Promise<ShuttleResult>                  // 新增：搬视频
  inbox(api, opts): Promise<InboxResult>                      // 新增：读/回 私信·评论·楼中楼·@
  user(api, input, days?): Promise<UserResult>                // 已有，补 userStat
  status(api, verify?): Promise<StatusResult>                 // 已有，改读 Settings
  search(api, keyword, type, order?, page?): Promise<...>     // 已有
  subscribe(api, input, action): Promise<...>                 // 已有 follow，改名
  manage(api, action, opts): Promise<...>                     // 新增：收藏/取消收藏/收藏夹列表
}
```

`ShuttleResult`：

```ts
interface ShuttleResult {
  picks: ShuttleRecord[]      // 已落库
  delivered: ('comment' | 'dm' | 'group')[]
  errors: string[]
  candidates: number
  scanned: number
}
```

`InboxResult`：

```ts
interface InboxResult {
  items: InboxItem[]
  replied?: { id: string, ok: boolean, error?: string }[]
}
```

---

## 6. 发布层（Agent C）

`src/publish.ts` 导出：

```ts
export interface PublishContext {
  ctx: Context
  settings: Settings
  api: Api
  store: Store
  logger: { info(...a: any[]): void, warn(...a: any[]): void }
}

/** 三个通道各自独立；返回实际成功的通道 */
export function deliver(pub: PublishContext, record: ShuttleRecord): Promise<('comment' | 'dm' | 'group')[]>

/** 群推送卡片 */
export function groupCard(record: ShuttleRecord): Fragment

/** 私信正文（≤470 字） */
export function dmText(record: ShuttleRecord): string
```

`src/summary.ts` 导出：

```ts
/** 某天的日报（Markdown，给人看） */
export function dailyReport(store: Store, day: string): string

/** 照片墙数据：按天分组的搬运记录 */
export function wall(store: Store, day: string): { day: string, items: ShuttleRecord[] }[]

/** 近 N 天的日报摘要（给 WebUI 列表） */
export function reportIndex(store: Store, days?: number): { day: string, count: number }[]
```

---

## 7. 控制台（Agent D）

`src/console.ts` 导出：

```ts
export function mountConsole(ctx: Context, deps: {
  settings: SettingsStore
  store: Store
  auth: AuthStore
  login: (session?: Session) => Promise<string>
  status: () => Promise<ConsoleStatus>
  shuttleNow: () => Promise<unknown>
  verify: () => Promise<unknown>
}): void
```

RPC 事件名统一前缀 `bili-slop/`：

| 事件 | 入参 | 出参 |
| --- | --- | --- |
| `bili-slop/settings` | `undefined` | `Settings` |
| `bili-slop/settings/update` | `Partial<Settings>` | `Settings` |
| `bili-slop/status` | `undefined` | `ConsoleStatus` |
| `bili-slop/login/start` | `undefined` | `{ key: string, url: string }` |
| `bili-slop/login/poll` | `{ key: string }` | `LoginPoll` |
| `bili-slop/shuttle` | `undefined` | `{ ok: boolean }` |
| `bili-slop/verify` | `undefined` | `unknown` |
| `bili-slop/summary` | `{ day?: string }` | `{ report: string, wall: ShuttleRecord[] }` |
| `bili-slop/reports` | `{ days?: number }` | `{ day: string, count: number }[]` |

`ConsoleStatus`：

```ts
interface ConsoleStatus {
  loggedIn: boolean
  selfId: string
  nickname?: string
  refreshedAt?: string
  ownerUid: string
  features: { comment: boolean, replyRoot: boolean, replySub: boolean, dm: boolean, transcribe: boolean, shuttle: boolean }
  ledger: { bvid: string, text: string, at: string, state: string, visible?: string }[]
  lastRun?: { at: string, picks: number, errors: string[] }
}
```

客户端：`ctx.page({ path: '/bili-slop', name: '刷B站', ... })` 注册单页，内部两个 tab（配置 / 总结）。
控制台客户端通过 `ctx.console.addListener` 发 RPC，服务端通过 `ctx.console.addListener` 接收。

---

## 8. 工具（8 个，`src/index.ts` 注册）

| 名称 | 中文 | 何时注册 |
| --- | --- | --- |
| `bili_video` | 看视频 | 始终 |
| `bili_shuttle` | 搬视频 | 始终 |
| `bili_search` | B站搜索 | 始终 |
| `bili_user` | B站用户查询 | 始终 |
| `bili_status` | B站状态查询 | 始终 |
| `bili_subscribe` | B站订阅 | 始终 |
| `bili_manage` | 视频管理 | 始终 |
| `bili_inbox` | 信息回复 | `allowComment || allowReplyRoot || allowReplySub` 时注册 |

旧名（`bili_comments` / `bili_comment` / `bili_reply` / `bili_dm` / `bili_find_slop` / `bili_follow`）**不再注册**。

---

## 9. 验收标准

1. `npm run build` 与 `npm run typecheck` 全绿。
2. `npm test` 全绿（含新增的 settings / publish / summary / store v3 迁移用例）。
3. 控制台「刷B站」页可打开，两个 tab 都有内容，改配置后 `settings.json` 落盘。
4. 8 个工具的 name/description 正确，`bili_inbox` 随开关出现/消失。
5. 三种发布方式各自可独立开关；群推送用 `ctx.broadcast(channels, fragment)`。
