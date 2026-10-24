# 变更记录

## 0.2.0（本次重构）

- 工具从 13 个批处理式（bili_prepare/bili_finish/runId）改为 9 个交互式：bili_video、bili_comments、bili_search、bili_user、bili_follow、bili_comment、bili_dm、bili_find_slop、bili_status。
- 视频参数统一接受 BV / av / 视频 URL / b23.tv·bili2233.cn 短链；用户参数接受 UID / 精确昵称（src/resolve.ts，本地 av↔BV）。
- 视频内容按 字幕 → sst ASR（可选）→ B站 AI 总结 获取；12000 字 offset 分页；字幕/转写按 bvid 持久缓存。
- bili_comment：禁止正文 @、atOwner 插件加真 @、≤150 字、同视频一条一级评论、每小时 10 条限速、sending→sent/unknown 不重放、约 60 秒后匿名复核可见性。
- bili_dm：read 默认主人；send 仅 ownerUid/dmWhitelist，正文 ≤470 字，支持图片 URL。
- 找屎榜单标记 shown，7 天排除；pushTimes 定时搬运与 watchUps 新投稿监听经 ctx.broadcast 直推 channels，不经过 LLM。
- Store v2：comments/transcripts/shown/watch/pushSlots；v1 自动迁移。
- 删除：收藏、回复轮次、bait、dmMode、ytDlpApiUrl、out/ 日报、digest 归档、MyGO 通道、runId 会话绑定；maxScan/days/minAtRatio/minDuration/asrMaxDuration 改为内置常量。

## 0.1.x（历史）

- 0.1.1–0.1.3：适配器分离、纯 Node 转写、sst 服务接入。详见 git 历史与旧 README。
