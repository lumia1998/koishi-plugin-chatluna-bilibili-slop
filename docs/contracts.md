# 接入与数据契约

## 运行环境

Node.js 20.19+、Koishi 4.18.9+、ChatLuna ^1.3.22 或 ^1.4.0-alpha.33、@lumia.wang/koishi-plugin-adapter-bilibili 0.1.2+。通过 ctx.bots 选择 platform=bilibili 的唯一 Bot，或按 selfId 精确选择；不直接发 B站 HTTP 请求，不读 Cookie 文件。

## 调用的适配器方法

| 方法 | 用途 |
| --- | --- |
| `internal.getVideoInfo(bvid)` | bili_video 元信息、评论发送目标 oid/aid |
| `internal.getVideoSubtitle(bvid)` | 字幕正文，按 bvid 缓存 |
| `internal.getVideoConclusion(bvid, cid, up_mid)` | B站 AI 总结（model_result.summary / outline） |
| `internal.getVideoAudio(bvid, {maxDuration:1800})` | ASR 音轨（存在性判断，0.1.2+） |
| `internal.getVideoComments(bvid, {limit, root, anonymous})` | 热评、楼中楼、匿名复核 |
| `internal.getUserVideos(uid, {days})` | bili_user 投稿、UP 监听、找屎召回 |
| `internal.getRelatedVideos(bvid)` | 找屎相关视频召回 |
| `internal.searchVideos(keyword, {order, page})` | bili_search / 找屎关键词召回 |
| `internal.searchUsers(keyword, {page})` / `searchUsersByName(name, true)` | bili_search / 昵称→UID |
| `internal.createVideoComment(bvid, text, mentions)` | 一级评论（支持真 @） |
| `internal.sendComment('video:'+aid, text, {oid,type,rpid,root,parent}, mentions)` | 回复评论 |
| `internal.getCommentVisibility(bvid, rpid, root)` | 发送后匿名复核 |
| `internal.followUser / unfollowUser / isFollowing` | bili_follow / bili_user |
| `internal.getUserInfo(uid)` | bili_user 资料 |
| `bot.getUser(uid)` | UID→昵称（@ 主人、回复目标） |
| `bot.sendPrivateMessage(uid, fragment)` | 私信发送（h.text + h.image） |
| `bot.getMessageList('private:'+uid, ...)` | 私信读取 |

未使用：收藏接口、动态轮询、直播接口、parseExternalUrl。

## 链接解析（src/resolve.ts）

- BV：`/BV[0-9A-Za-z]{10}/` 从任意字符串提取。
- av：`av(\d+)` 或 `/video/av\d+`，本地 av↔BV 转换（向量 av170001↔BV17x411w7KC）。
- 短链：仅 `b23.tv` / `bili2233.cn`，`fetch(url,{redirect:'manual'})` 只读 Location，最多 3 跳，仅允许跳往 `*.bilibili.com` 或短链域；其他 host 拒绝（防 SSRF）。
- 失败统一提示「无法识别视频，请提供 BV 号、av 号或 B站视频链接」。

## sst 转写

`transcribe=false` 时不下载音频、不调用 sst。开启且无字幕时：
- sst 实例存在 `transcribe(buffer)` → 直接传 Buffer（快路径）；
- 否则用 `audio2text(session)`，session 由 B站 Bot 工厂创建、只含一条 `audio/mp4` 元素。
- 串行队列；识别文本按 bvid 写入 `transcripts` 缓存，同视频不再重复下载/转写。

## 工具契约

所有工具要求 ChatLuna `runnable.configurable.session`；允许名单 `platform:userId`，否则 `observeUser` 检查 authority。结果统一 `{ok:true,result:...}` / `{ok:false,error:string}`。

- `bili_comment` 规则在工具层强制：正文不得含 `@`；`atOwner` 由插件解析 ownerUid 昵称加真 @（一级评论走 createVideoComment mentions，回复走 sendComment 的 `at_name_to_mid`）；加 @ 后 ≤150 字；同账号同视频仅一条一级评论；全局每小时 ≤10 条；发送前记 `sending`，异常记 `unknown` 且不重放；返回 rpid 后约 60 秒后台匿名复核写回 `visible`。
- `bili_dm send`：收件人仅 `ownerUid` 或 `dmWhitelist`；正文 ≤470 字；image 为 http(s) URL 时与 text 组合发送。`allowDm=false` 时 send 直接拒绝且工具描述中注明。
- `bili_find_slop`：返回的视频记入 `shown`，7 天内默认排除；`includeShown` 可包含。不读字幕、不跑 ASR。

## 调度（不经过 LLM）

- `pushTimes`：每分钟检查 Asia/Shanghai 当前时刻是否命中槽位且今日未推；命中则跑找屎同一套逻辑（排除已展示）→ `ctx.broadcast(channels, card)`，卡片含封面（有 pic 时）、标题、UP、链接、时长、@率、热评证据。已推槽位 `pushSlots` 持久化，仅留 7 天。
- `watchUps`：每 `watchInterval` 分钟串行查 `getUserVideos(uid,{days:3})`；首次仅写 `watch[uid]` 基线；新 pubdate > 基线时推送同格式卡片；UP 之间间隔 5 秒。
- `channels` 为空时两项都不启动；回调内所有异常只记日志。

## 状态（version 2）

`state.json`：`comments`（沿用 Publication）、`transcripts`（bvid→{text,source,at}）、`shown`（bvid→ts）、`watch`（uid→pubdate）、`pushSlots`（'YYYY-MM-DD HH:MM'→true）。v1 迁移：保留 comments，丢弃 runs，seen 的 bvid 写入 shown。损坏文件拒绝启动。`store.locked` 只包状态读写，网络请求与 ASR 在锁外。
