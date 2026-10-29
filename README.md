# koishi-plugin-chatluna-bilibili-slop

个人使用，不推荐任何人下载。

把 B站能力注册为 ChatLuna 工具：看任意视频内容（字幕 / 语音识别 / AI 总结）、搬运屎视频到群里、回复私信与评论、查用户、搜索、关注、管理收藏。所有配置都在控制台的「刷B站」面板里，ChatLuna 插件详情页保持空白。

B站登录、Cookie 与站内 API **由本插件原生实现**，不依赖任何 B站适配器：自带扫码登录、官方 Cookie 刷新链路和 WBI 签名。无字幕转写走 Koishi `sst` 服务（如 doubao-asr）。

## 依赖与安装

- Node.js 20.19+、Koishi 4.18.9+。
- ChatLuna 1.3.22+ 或 1.4 测试版，使用支持工具调用的模型。
- 可选：`koishi-plugin-doubao-asr` 等 sst 提供者，用于无字幕视频的语音转写（需要提供 `transcribe(buffer)`）。

```bash
npm install && npm run build && npm pack
```

装好后打开控制台左侧的「刷B站」页面，在「配置」标签里扫码登录即可。

## 控制台面板

页面分四个标签：**配置**、**搬运历史**、**日报**、**观看历史**。配置全部落盘在 `<data>/chatluna-bilibili-slop/settings.json`，聊天里的工具实时读取同一份。

### 配置

| 分组 | 内容 |
| --- | --- |
| 账号状态 | 扫码登录（二维码在页面里画）、评论台账；页面右侧常驻「概况」栏，列出登录账号、主人 UID、凭证刷新时间和每个能力开关的开 / 关 |
| 主人 | 主人 UID：评论区 @ 的对象、私信默认收件人；可一键设为当前登录账号 |
| 偏好设置 | 搜索关键词、追踪作者、视频分区、屏蔽词、最短 / 最长时长 |
| 发布方式 | ① 评论区 @ 主人（公开可见）② B站私信 ③ 推送到 Koishi 群组（`platform:channelId`，默认 onebot）；三项独立可多选 |
| 互动方式 | ① 在视频下发表评论 ② 回复一级评论（楼层）③ 回复二级评论（楼中楼）；每小时评论上限、额外 @、私信白名单 |
| 解析方式 | 优先提取视频原字幕 → 降级调用 Koishi `sst` 服务转写 |
| 日报 | 选一个 ChatLuna 模型写日报（列表来自 ChatLuna 已加载的对话模型）；选「不用模型」时只输出记录清单 |
| 高级 | 机器人 UID、权限等级、放行用户、每轮条数、默认收藏夹、编造诱饵 |

### 搬运历史

按时间倒序排成时间线，每条一张卡片：封面、时长、标题、作者、播放 / 评论、**搬运理由**、投递渠道与得分。点卡片看详情（UID、搬运时间、得分、@ 占比、内容摘要、证据热评、已推送通道）。页面顶部是「立即搬一轮」「复核评论」，排期交给 ChatLuna 触发器时这里只用于当场补一轮。

### 日报

按天汇总当天搬过的视频，正文用 Markdown 渲染。点「AI 写日报」会用配置页选中的模型，结合标题、作者、搬运理由与内容摘要写一篇日报；没选模型时显示按记录拼出的清单。可一键复制导出。

### 观看历史

每次聊天里用 `bili_video` 看视频都会记一条（封面、标题、作者、时长、时间，以及这次正文来自原字幕 / 语音转写 / AI 总结 / 无）。同样按时间线排列，点开直接在 B站播放。

## 使用

直接对 ChatLuna 说：

```text
看看这个视频讲了什么：https://www.bilibili.com/video/BV1xx411c7mD
搬点屎视频到群里，理由写得缺德一点
谁在我的视频下面 @ 我了，挑几条回一下
```

`video` 参数统一接受 BV 号、av 号、视频页 URL、b23.tv / bili2233.cn 短链；`user` 接受数字 UID 或精确昵称。

指令：

| 指令 | 用途 |
| --- | --- |
| `bili` | 登录状态与能力总览 |
| `bili login` | 扫码登录（发二维码，后台轮询） |
| `bili logout` | 删除本机凭证 |
| `bili ledger` | 最近评论台账 |
| `bili verify` | 匿名复核最近评论可见性 |
| `bili push` | 立即按偏好手动搬运一次 |

## 工具（8 个）

已注册工具默认对 ChatLuna 和 chatluna-character 开放，character 群聊、私聊均可调用；调用仍受插件权限及互动开关限制。

| 工具 | 说明 |
| --- | --- |
| `bili_video` | **看视频**：标题、UP、时长、播放、点赞、投币、收藏、分享、评论、弹幕数 + 视频内容；内容按 字幕 → ASR → AI 总结 → none 降级，12000 字分页 |
| `bili_shuttle` | **搬视频**：按偏好（关键词、作者、时长、过滤词）召回屎视频 / 抽象视频，解析内容后按「发布方式」发到评论区 / 私信 / 群。`reason` 必填，由模型现场写；也可传 `video` 直接搬指定一条 |
| `bili_inbox` | **信息回复**：读 / 回私信、视频评论、楼中楼、@ 提醒。三个互动开关全关时不注册 |
| `bili_user` | **用户查询**：昵称、签名、粉丝数、关注数、投稿数、等级、近 N 天投稿、是否已关注 |
| `bili_status` | **状态查询**：登录状态、Cookie 是否过期、能力开关、最近评论台账；`verify=true` 顺带匿名复核 |
| `bili_search` | **搜索**：按关键词搜视频（可排序）或用户 |
| `bili_subscribe` | **订阅**：关注 / 取关 UP |
| `bili_manage` | **视频管理**：列收藏夹、收藏到指定分类、取消收藏 |

评论安全约束（由插件强制，模型绕不过）：评论正文不能出现 ASCII `@`（插件用 `at_name_to_mid` 真@），评论 + @ 合计 ≤ 150 字，同账号同一视频只发一条一级评论，全局限速 `commentPerHour`，发送结果未知记为 `unknown` 且**永不重发**。

评论可见性：`public` 匿名可见，`pending` 仅登录态可见，`missing` 未查到。发送后约 60 秒插件自动后台复核一次。

## 登录与凭证

- `bili login` 或面板里的「扫码登录」→ 成功后写 `<data>/chatluna-bilibili-slop/credential.json`（0600）。
- 扫码确认时**选「记住我 / 长期」**；选 24 小时的话第二天就得重扫。
- 凭证里同时保存 `refresh_token`，插件每 6 小时和启动 30 秒后各检查一次，需要时走官方链路刷新：`cookie/info → correspondPath → correspond/1 → cookie/refresh → confirm/refresh`。
- 任何接口返回 `-101` 会先自动刷新一次再重试；刷新也失败才提示重新登录。
- `bili logout` 删除本机凭证。

## 存储

`data/chatluna-bilibili-slop/` 下三个文件，全部 tmp + rename 原子写：

| 文件 | 内容 |
| --- | --- |
| `settings.json` | 面板里的全部配置 |
| `credential.json` | B站登录凭证（0600） |
| `state.json`（version 3） | `comments` 评论台账、`transcripts` 文本缓存、`shown` 已展示、`watch` UP 基线、`shuttles` 搬运记录 |

v1 / v2 台账自动迁移到 v3；损坏文件拒绝启动，`settings.json` 损坏则退回默认值。

## 验证

```bash
npm test && npm run typecheck
npm run build   # 产出 lib/index.cjs + dist/index.js + dist/style.css
```

测试全部使用模拟 API，不登录真实账号、不发送真实请求。

## 0.3.0 变更

**配置全部搬进 WebUI，工具从 10 个收敛为 8 个；登录与站内请求改为原生实现，不再依赖 B站适配器。**

### WebUI 配置与工具收敛

- ChatLuna 原生配置页清空为 `Schema.object({})`；配置改由 `src/settings.ts` + 控制台面板读写，工具侧通过活的 `Proxy` 实时读取，改配置不用重载插件
- 控制台改为单页四标签：「配置」（左侧目录：账号状态 / 主人 / 偏好设置 / 发布方式 / 互动方式 / 解析方式 / 日报 / 高级；右侧常驻「概况」状态栏）、「搬运历史」（时间线 + 手动操作）、「日报」（Markdown 渲染）、「观看历史」（`bili_video` 看过的视频）
- 直链打开或刷新 `/bili-slop` 不再被控制台 auth 的会话恢复跳去用户资料页
- 新增 `src/publish.ts`：评论 / 私信 / 群三条投递通道互相独立，评论正文禁用 `@` 并保留链接
- 新增 `src/summary.ts`：按天生成日报与按天分组的搬运记录
- 新增 `src/report.ts`：日报可选接一个 ChatLuna 模型。模型列表走 `ctx.chatluna.platform.listAllModels('llm')`，生成走 `awaitLoadPlatform` + `createChatModel` + `invoke`，不经过 ChatLuna 的会话/投递层；模型名存 `settings.summaryModel`（只认 `platform/name` 全名），留空就只列记录清单
- 控制台新增两个 RPC：`bili-slop/models`（可选模型 + 当前选中）与 `bili-slop/summary/generate`（按天生成 AI 日报）
- 状态卡补上登录账号昵称（查一次缓存）与「上次搬运」（同一轮写入的 `shuttles` 共用一个 `at`，按它归组计数），不再固定 `undefined`
- 群推送前检查目标平台是否有在线 bot：`broadcast` 对没有在线 bot 的平台是静默空转，现在会先跳过并记警告，不再谎报「已推送」
- `transcripts` 保留 30 天、`shuttles` 保留 90 天，`prune()` 里按 `at` 清理；状态文件结构不变
- 移除 `src/config.ts` 里没人调用的 `effectiveKeywords` / `parseWindow`
- `bili` 命令不再在注册时卡 authority（Koishi 的命令权限是注册时求值的快照，改了要重载才生效）；真正的门槛仍在 action 里每次执行读取的 `access()`
- 工具收敛：`bili_video` / `bili_shuttle` / `bili_inbox` / `bili_user` / `bili_status` / `bili_search` / `bili_subscribe` / `bili_manage`；旧的 `bili_comments`、`bili_comment`、`bili_reply`、`bili_dm`、`bili_find_slop`、`bili_follow` 不再注册
- 搬运理由改为模型现场写（`bili_shuttle.reason` 必填），不再由插件拼模板
- 收藏能力恢复为 `bili_manage`
- 移除 `cruise` / `cruiseInterval` / `peakValley` / 窗口配置 / `watchUps` / `pushDetail` / `dmMode` / `mode`
- 移除定时搬运（`pushTimes` / `startPush` / `pushSlots`）：排期交给 ChatLuna 触发器，插件只保留 `bili_shuttle` 工具与控制台的「立即搬一轮」
- 状态文件升到 version 4，新增 `shuttles`（搬运记录）与 `views`（观看历史）

### 登录与请求原生实现

- 新增 `src/auth.ts`：二维码登录、凭证存储（0600）、官方 Cookie 刷新链路、buvid3 兜底、登录态检查
- 新增 `src/http.ts`：Cookie 合并、WBI 签名（含每日密钥缓存）、`-101` 自动刷新重试、下载限流
- 新增 `src/bili.ts`：视频 / 字幕 / AI 总结 / 评论 / 搜索 / 用户 / 关注 / 收藏 / 私信的原生实现
- 移除 `@lumia.wang/koishi-plugin-adapter-bilibili` 的 peer/dev 依赖
- 新增 `bili login` / `bili logout`；启动后 30 秒与每 6 小时自动续期
- 依赖变化：新增 `qrcode`
