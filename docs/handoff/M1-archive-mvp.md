# M1 — 归档 → 库 → 搜索 → 转发

日期：2026-09-28 · 状态：✅ 达成（八条门禁全过，真机验证完成）

## 1. 目标与结论

Bot 归档 → SQLite → 桌面 Library/详情/搜索/forward 全链路打通。真机数据（归档群相册：1 视频 + 3 图）完成入库、缩略图、规则标签、搜索与 Telegram 转发的端到端验证。

期间解决的关键问题：Privacy Mode 阻塞（用户设为管理员/关闭后解决）、Telegram API 需代理（`TELEGRAM_PROXY_URL`）、grammY 报错泄漏 token（logger 全局脱敏）。

## 2. 可复现命令与原始输出

```bash
# 单测 + 类型检查
$ pnpm -F @tma/core test          # Test Files 4 passed | Tests 28 passed
$ pnpm -r typecheck               # 三包全绿

# —— 真机链路（Bot @Xiyuu_bot 经代理长轮询）——
INFO: Bot 已连接，开始长轮询  username: "Xiyuu_bot"  proxy: "on"
# 用户转发一个相册（1 视频 + 3 图）到归档群：
INFO: 归档入库  messageId: 179 / 180 / 181 / 182
$ curl localhost:8787/api/stats
{"totalAssets":4,"todayAdded":4,...}

# 缩略图（经代理真实下载，缓存命中后 <10ms）
GET /api/media/1/thumbnail → HTTP 200, 11496 bytes  # 视频封面 320x200 JPEG
GET /api/media/2/thumbnail → HTTP 200, 72311 bytes  # 照片 1280x720 JPEG

# 附言 hashtag → 规则标签回填（幂等）
POST /api/admin/reindex-search → {"ok":true,"count":4,"tagsAdded":3,"tookMs":8}
GET /api/media?limit=5 → asset#1 tags: ["Redgectx","小吱","异环"]

# 转发真机（copy 模式 → 用户私聊）
POST /api/media/1/forward → {"ok":true,"chatId":5596727844,"messageId":51,"mode":"copy"}
audit_events: telegram.message.forwarded | user | {"mediaId":1,"chatId":5596727844,"messageId":51,"mode":"copy"}
# UI 侧同样走通：弹窗预填目标 → 发送 → mutation toast「已复制到 Telegram（消息 #52）」
#   + WS 事件 toast「已转发到 Telegram」

# 演示库（离线复现，独立数据目录）
$ pnpm -F @tma/core seed:demo
演示库已生成：apps/core/.data-demo
  media_asset=11（新建 11）telegram_message=13
# ↑ 11 条唯一媒体 + 1 次重复投递（跳过）+ 1 次同文件转发（复用）+ 1 次 dedupe_key 合并

# 搜索（真机数据 + 演示数据）
POST /api/search {"query":"绝命毒师"} → strategy=fts, hits=2, 2ms
POST /api/search {"query":"毒师"}     → strategy=like（trigram 需 ≥3 字）
GET /api/media?quality=2160p → 3 项；GET /api/media?tag=收藏 → 1 项
```

浏览器实拍（localhost:5173 → 真实库 8787）：Dashboard 四卡 + 最近媒体 + 失败任务；Library 网格显示真实缩略图（视频封面 + 时长角标、照片原图）；详情页深链 `https://t.me/c/2464626889/179`、确定性字段、规则标签可删改、来源附言原文；搜索页显示策略与耗时。

## 3. 验收清单（对照 roadmap M1 八条）

- [x] 1. 归档群发视频 → 入库：真机 4 条（相册 1 视频 + 3 图），Privacy Mode 问题解决后立即入库
- [x] 2. 样本 11 asset / 13 message：演示库输出与预期逐字一致；真机侧复用/合并路径由单测覆盖
- [x] 3. Library + 详情字段：真机缩略图渲染、深链、字段与 Telegram 一致
- [x] 4. 中文搜索命中 + `2160p` 结构化过滤：FTS/LIKE/结构化三路径实测
- [x] 5. forward 真机：API copy 送达（消息 #51）+ UI 全流程（消息 #52），audit 与 toast 一致
- [x] 6. `pnpm -r typecheck && pnpm -F @tma/core test` 全绿（28 用例）
- [x] 7. 数据持久化：seed 进程写入 → 独立 core 进程读取；core 重启后 Bot 自动恢复（tsx watch 多次重载验证）
- [x] 8. 本文档

## 4. 已知问题与偏离

| 项 | 说明 |
|---|---|
| Privacy Mode（已解决） | Bot 默认隐私模式只收命令（`can_read_all_group_messages:false` 实测）；用户将其设为归档群管理员后消息正常下发 |
| Telegram 需代理 | api.telegram.org 直连超时（实测 000 / 代理 302）；已加 `TELEGRAM_PROXY_URL`（grammY 走 https-proxy-agent，缩略图下载同样走代理） |
| **Token 泄漏已修复** | grammY 报错会把完整 URL（含 token）带进日志 → logger 增加全局密钥脱敏钩子（`registerSecret` + 深拷贝 sanitize，覆盖 Error.message/stack/嵌套对象）；开发期终端输出中曾出现 token，**建议用 BotFather `/revoke` 轮换后更新 .env**（未轮换前勿分享日志文件） |
| better-sqlite3 安装 | v13 的 install 脚本是遗留的 node-gyp（本机无 Python 会失败）→ pnpm `allowBuilds: better-sqlite3: false`，运行时直接用包内 `prebuilds/win32-x64.node` |
| Vite EBUSY | cargo 写 `src-tauri/target/` 时 Vite 监听器崩溃 → `server.watch.ignored: ['**/src-tauri/**']` |
| 短查询限制 | trigram 需 ≥3 字符，2 字查询走 LIKE（覆盖 `media_search_doc` 全字段），已在 UI 说明 |
| 相册 | `media_group_id` 已记录、各条独立入库（与去重策略一致）；批量转发保持相册语义留到 M2 |
| "2K" 等非标准分辨率标记 | 规则解析不认（只认 2160p/1440p/1080p 等标准 token），留在标题里；如需可扩展 QUALITY 映射 |

## 5. 下一里程碑入口（M2）

- 演示库保留在 `apps/core/.data-demo`（gitignored，`pnpm -F @tma/core seed:demo` 可重建；`.data-demo` 属主库之外的独立目录）
- M2：MTProto 通道（mtcute）——历史扫描/断点续扫/copy 无转发头；`telegram_message.via/remote_ref` 列已预留，无需迁移；需要用户提供一个小号 session（登录脚本生成，session 绝不入 git）
