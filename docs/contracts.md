# 接入与数据契约（0.3.0）

## 运行环境

Node.js 20.19+、Koishi 4.18.9+、ChatLuna ^1.3.22 或 ^1.4.0-alpha.33。**不依赖任何 B站适配器**：登录、Cookie、WBI 签名与站内请求都在插件内完成。

## 登录与凭证

- `bili login` 或面板「扫码登录」：`/x/passport-login/web/qrcode/generate` 出码 → `poll` 轮询（86101/86090/86038/0）。
- 成功时从**响应头 `Set-Cookie`** 取 `SESSDATA / bili_jct / DedeUserID / DedeUserID__ckMd5 / sid`，从 `data.refresh_token` 取刷新令牌；缺 `buvid3` 时用 `/x/frontend/finger/spi` 补。
- 凭证落在 `<data>/chatluna-bilibili-slop/credential.json`（0600），结构 `{version, mid, cookies, refreshToken, obtainedAt, refreshedAt?}`。
- 刷新（`src/auth.ts`）：`cookie/info` → `correspondPath = RSA-OAEP-SHA256("refresh_"+ms)` → `/correspond/1/{path}` 取 `refresh_csrf` → `cookie/refresh` → **先落盘** → `confirm/refresh`（用旧 token 作废）。
- 触发时机：启动 30 秒后、每 6 小时、以及任意接口返回 `-101` 时（单飞，重试一次）。

## 配置

- ChatLuna 插件详情页是 `Schema.object({})`，**不接受任何输入**。
- 全部字段定义在 `src/settings.ts` 的 `Settings`，落盘 `<data>/chatluna-bilibili-slop/settings.json`。
- 读写只走控制台 RPC：`bili-slop/settings` 与 `bili-slop/settings/update`；`normalize()` 丢弃未知键、按目标类型强转、钳制数值（旧版 `channels` 字段即在此静默丢弃）。
- 日报相关另有两个 RPC：`bili-slop/models` 返回 `{models, selected}`（模型列表来自 ChatLuna 的 `platform.listAllModels('llm')`），`bili-slop/summary/generate` 按天生成正文。两者都要求 authority 3。
- 两个历史页各有一个只读 RPC：`bili-slop/history` 返回 `shuttles` 全量（时间倒序），`bili-slop/views` 返回 `views` 全量（时间倒序），并在读取时把 `shuttles[bvid].reason` 合并进每条记录。同样 authority 3。
- `summaryModel` 只接受 `platform/name` 全名（`/^[^/\s]+\/\S+$/`），填半截或带空格一律归空；空值表示不调模型，日报只列记录清单。
- 运行时通过 `liveSettings()` 返回的 `Proxy` 每次读当前值，改配置不需要重建 `Service`。

## 原生接口（`src/bili.ts`）

| 方法 | 上游接口 |
| --- | --- |
| `getVideoInfo` | `/x/web-interface/view` |
| `getVideoSubtitle` | `/x/player/wbi/v2`（WBI）+ 字幕 CDN |
| `getVideoConclusion` | `/x/web-interface/view/conclusion/get`（WBI） |
| `getVideoComments` | `/x/v2/reply/main` 或 `/x/v2/reply/reply` |
| `getVideoStats` | `/x/web-interface/view` 的 `stat` 字段（点赞 / 投币 / 收藏 / 分享 / 弹幕） |
| `getVideoDanmaku` | `/x/v1/dm/list.so`（XML，取前 N 条） |
| `getVideoAudio` | `/x/player/wbi/playurl`（WBI，AAC 30216/30232/30280） |
| `searchVideos` / `searchUsers` | `/x/web-interface/wbi/search/type`（WBI） |
| `getUserVideos` | `/x/space/wbi/arc/search`（WBI，需登录） |
| `getUserInfo` / `getUserStat` | `/x/web-interface/card`、`/x/relation/stat`（粉丝 / 关注 / 投稿数） |
| `followUser` / `unfollowUser` / `isFollowing` | `/x/relation/modify`、`/x/relation` |
| `getFavoriteFolders` / `addVideoToFavorite` / `isInFavorite` | `/x/v3/fav/folder/created/list-all`、`/x/v3/fav/resource/deal`（收藏后复核） |
| `createVideoComment` / `sendComment` | `/x/v2/reply/add`（`at_name_to_mid` 映射真 @） |
| `getInbox` | `/x/msgfeed/reply`、`/x/msgfeed/at`（评论 / @ 提醒） |
| `getCommentVisibility` | 匿名 / 登录两次拉评论比对（public / pending / missing） |
| `sendPrivateMessage` | `web_im/v1/web_im/send_msg`（WBI），图片走 `upload_bfs` |
| `getMessageList` | `svr_sync/v1/svr_sync/fetch_session_msgs` |

## 失败语义

- 未登录的写操作直接报「先执行 bili login」，不发请求。
- 评论发送结果未知时不重发：台账先写 `sending`，异常改 `unknown` 并永久拒绝同目标重试。
- 投票 / 点赞 / 收藏这类附属请求失败只降级，不影响主结果。
- 匿名可用的读接口（视频、评论、搜索）在未登录时仍可用；`getUserVideos` 需要登录态。

## 工具契约（8 个）

全部要求 ChatLuna `runnable.configurable.session`；允许名单 `platform:userId`，否则 `observeUser` 检查 authority。结果统一 `{ok:true,result}` / `{ok:false,error}`。

| 工具 | 约束 |
| --- | --- |
| `bili_video` | 字幕 → ASR（`preferSubtitle` / `transcribe`）→ AI 总结 → none；12000 字分页；每次成功都写一条 `views` |
| `bili_take` | 写锐评（2–200 字）；`views` 里已有就更新 `take / takeAt`，没有就先 `getVideoInfo` 补一条最小记录 |
| `bili_shuttle` | `reason` 必填（2–60 字，模型现场写）；7 天内不重搬；投递按 `publishComment` / `publishDm` / `publishGroup`，其中群推送发到调用工具的那个 `Session` |
| `bili_inbox` | 常驻注册；读取永远可用，回复按 `allowComment` / `allowReplyRoot` / `allowReplySub` 在 service 里逐条拦 |
| `bili_user` | 资料 + 粉丝 / 关注 / 投稿数 + 近 N 天投稿 + 是否已关注 |
| `bili_status` | 登录态、能力开关、最近 20 条台账；`verify` 顺带匿名复核 |
| `bili_search` | 视频按 `totalrank/click/pubdate/dm/stow/scores` 排序；用户返回 UID / 昵称 / 签名 / 粉丝 |
| `bili_subscribe` | `follow` / `unfollow` |
| `bili_manage` | `list` 收藏夹、`add` 收藏到分类、`remove` 取消收藏 |

旧名（`bili_comments` / `bili_comment` / `bili_reply` / `bili_dm` / `bili_find_slop` / `bili_follow`）**不再注册**。

### 评论安全约束（插件强制，模型绕不过）

- 正文禁止 ASCII `@`（`publish.ts` 的 `sanitize()` 把 `@` 换成全角 `＠`，真 @ 由 `at_name_to_mid` 建立）。
- 加 @ 后合计 ≤ 150 字；私信 ≤ 470 字。
- 同账号同一视频只发一条一级评论；同一楼层只回一次。
- 全局限速 `commentPerHour`（1–30），窗口 1 小时。
- 发送结果未知记 `unknown`，永不重放。

## 投递与日报

- `src/publish.ts`：`deliver()` 三条通道互相独立，各自 try/catch，返回实际成功的通道；记录先落库再发布，`delivery` 回写。`publishGroup` 用调用工具时传下来的 `Session` 直接 `session.send()`，没有会话（控制台手动搬运 / 定时任务）就跳过并记日志，不广播到别的群。
- `src/summary.ts`：`dailyReport(store, day)` 出 Markdown，`wall(store, day)` 出照片墙分组，`reportIndex(store, days)` 出可查日期。切日口径固定 `Asia/Shanghai`。
- `src/report.ts`：`listModels(ctx)` 给配置页下拉，`aiReport(ctx, store, day, modelName)` 走 `awaitLoadPlatform` → `createChatModel` → `model.value.invoke([SystemMessage, HumanMessage], {timeout: 120s})`，正文用 `getMessageContent()` 取。不经过 ChatLuna 的会话与投递层；失败直接抛，前端保留原来的清单正文。

## 调度

插件**不自带调度器**。搬运只由 ChatLuna 工具 `bili_shuttle` 触发，排期交给 ChatLuna 的触发器或外部插件；控制台的「立即搬一轮」走同一个 `service.shuttle()`。工具在注册时 `defaultAvailability` 全开（`enabled / main / subAgent / chatluna`，`characterScope: 'all'`），装上即可被主插件与角色插件调用。

## 状态（version 4）

`state.json`：`comments`（台账）、`transcripts`（bvid→文本，字幕 / ASR 共用）、`shown`（7 天去重）、`watch`（UP 基线）、`shuttles`（搬运记录）、`views`（品鉴历史）。v1 / v2 / v3 自动迁移到 v4；损坏拒绝启动。`store.locked` 只包状态读写，绝不包网络或转写。

`views` 由 `service.video()` 在拿到视频信息后写入（`bvid / title / author / uid / url / pic / duration / at / source / description / excerpt`），`service.take()` 回填 `take / takeAt`。控制台「品鉴历史」直接读它，右侧按 锐评 → 搬运理由 → 正文 回退显示；`reason` 不落盘，读时从 `shuttles[bvid]` 合并。

`prune()` 按 `at` 清理三个无界增长的映射：`transcripts` 留 30 天（只服务最近几次「看视频」），`shuttles` 与 `views` 各留 90 天。
