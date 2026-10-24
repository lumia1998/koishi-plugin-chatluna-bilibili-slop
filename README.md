# koishi-plugin-chatluna-bilibili-slop

个人使用，不推荐任何人下载。

把 B站能力注册为 ChatLuna 工具：看任意视频内容（字幕 / 语音识别 / AI 总结）、搜视频和用户、收发私信、发评论和回复、关注 UP、按评论区行为寻找抽象/赤石视频，并可定时把找到的"屎视频"推送到聊天群、监听 UP 新投稿。

B站登录、凭证和站内 API 复用 [@lumia.wang/koishi-plugin-adapter-bilibili](https://www.npmjs.com/package/@lumia.wang/koishi-plugin-adapter-bilibili)；无字幕转写走 Koishi `sst` 服务（如 doubao-asr）。

## 依赖与安装

- Node.js 20.19+、Koishi 4.18.9+。
- ChatLuna 1.3.22+ 或 1.4 测试版，使用支持工具调用的模型。
- @lumia.wang/koishi-plugin-adapter-bilibili 0.1.2+。
- 可选：`koishi-plugin-doubao-asr` 等 sst 提供者，用于无字幕视频的语音转写。

先在 Koishi 中启用适配器并扫码登录，再安装本插件包并启用。多个 B站 Bot 时用 `selfId` 指定账号。

```bash
npm install && npm run build && npm pack
```

## 使用

直接对 ChatLuna 说：

```text
看看这个视频讲了什么：https://www.bilibili.com/video/BV1xx411c7mD
帮我找点屎视频
给主人发私信说我到家了
```

`video` 参数统一接受 BV 号、av 号、视频页 URL、b23.tv / bili2233.cn 短链；`user` 接受数字 UID 或精确昵称。

指令：

| 指令 | 用途 |
| --- | --- |
| `bili` | 账号与能力状态 |
| `bili ledger` | 最近评论台账 |
| `bili verify` | 匿名复核最近评论可见性 |
| `bili push` | 立即手动跑一次找屎搬运 |

## 工具（9 个，按配置注册）

| 工具 | 说明 |
| --- | --- |
| `bili_video` | 视频元信息 + content；字幕 → ASR（需 transcribe）→ AI 总结 → none，12000 字分页 |
| `bili_comments` | 热评；传 root 读楼中楼 |
| `bili_search` | 搜索视频或用户 |
| `bili_user` | 用户资料 + 近 N 天投稿 + 是否已关注 |
| `bili_follow` | 关注 / 取关（`allowFollow` 开启才注册） |
| `bili_comment` | 一级评论或回复（`allowComment` 开启才注册）。正文禁 @，`atOwner` 由插件 @ 主人；同视频一条一级评论；每小时 10 条限速 |
| `bili_dm` | `read` 读私信（默认主人）；`send` 发文字 / 图片，仅主人或白名单（`allowDm` 关闭时 send 拒绝） |
| `bili_find_slop` | 按热评 @ 密度等行为评分找抽象视频，带证据；已展示 7 天内自动排除 |
| `bili_status` | 账号、主人、能力开关、最近 20 条评论台账；`verify` 可顺带复核 |

评论可见性：`public` 匿名可见，`pending` 仅登录态可见，`missing` 未查到。发送后约 60 秒插件自动后台复核一次。

## 配置

| 分组 | 项 | 默认 | 说明 |
| --- | --- | --- | --- |
| 账号 | `selfId` | 空 | B站机器人 UID，只有一个时可留空 |
| | `ownerUid` | 空 | 主人 B站 UID，用于 @ 和默认私信收件人 |
| 权限 | `authority` | 3 | 工具最低 Koishi 权限 |
| | `allowedUsers` | [] | 额外允许用户，`platform:userId` |
| 能力 | `allowComment` | false | 注册 bili_comment |
| | `allowDm` | false | bili_dm 允许发送 |
| | `dmWhitelist` | [] | 额外可私信 UID 名单（主人始终可发） |
| | `allowFollow` | false | 注册 bili_follow |
| | `transcribe` | false | 无字幕时走 sst 转写音轨 |
| 找屎 | `keywords` | 内置默认词 | 搜索关键词 |
| | `ups` | 内置名单 | 追踪 UP 主 UID / 昵称 |
| 搬运 | `channels` | [] | 推送频道 `platform:channelId`，空则关闭全部推送 |
| | `pushTimes` | [] | 每日搬运时刻（Asia/Shanghai），如 `["12:00","20:00"]` |
| | `pushCount` | 3 | 每次搬运条数 |
| | `watchUps` | [] | 监听新投稿的 UP 主 |
| | `watchInterval` | 30 | 监听轮询分钟数（最小 10） |

字幕与转写结果按 BV 号持久缓存；已展示视频记录 7 天；评论台账记录发送与可见性状态，未知结果不会自动重发。

## 存储

`data/chatluna-bilibili-slop/state.json`（version 2）：`comments` 台账、`transcripts` 文本缓存、`shown` 已展示、`watch` UP 基线、`pushSlots` 已推槽位。v1 台账自动迁移；损坏文件拒绝启动。

## 验证

```bash
npm test && npm run typecheck
```

测试全部使用模拟 API，不登录真实账号、不发送真实请求。

## 0.2.0 变更

重构为 9 个交互式工具与内置调度，取代旧的 `bili_prepare`/`bili_finish` 批处理流程（旧工具 bili_prepare、bili_finish、bili_scout、bili_up_feed、bili_reply、bili_favorite_lists、bili_verify、bili_history、bili_subtitle、bili_video_info 已删除）；移除收藏、bait、dmMode、yt-dlp 下载、本地日报归档与 MyGO 专用通道；新增链接解析（av/短链）、定时搬运与 UP 监听。
