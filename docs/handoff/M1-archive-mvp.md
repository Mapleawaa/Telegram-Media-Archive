# M1 — 归档 → 库 → 搜索 → 转发

日期：2026-09-28 · 状态：🟡 实现完成，真机门禁待用户操作（隐私模式 / 转发目标）

## 1. 目标与结论

Bot 归档 → SQLite → 桌面 Library/详情/搜索/forward 全链路。**代码侧全部完成并通过离线验证**（24 个单测 + 演示库端到端 + 浏览器实拍）。

阻塞项：Bot 的 Privacy Mode 默认开启（`can_read_all_group_messages: false` 已通过 getMe 实测），归档群里的普通消息不会被推送给 Bot → **需要用户在 BotFather 关闭 Group Privacy，或把 Bot 设为归档群管理员**（管理员不受隐私模式限制）。

## 2. 可复现命令与原始输出

```bash
# 单测 + 类型检查
$ pnpm -F @tma/core test          # Test Files 4 passed | Tests 24 passed
$ pnpm -r typecheck               # 三包全绿

# 演示库（独立数据目录，不污染真实数据）
$ pnpm -F @tma/core seed:demo
演示库已生成：apps/core/.data-demo
  media_asset=11（新建 11）telegram_message=13
# ↑ 与门禁 #2 完全一致：11 条唯一媒体 + 1 次重复投递（跳过）+ 1 次同文件转发（复用）+ 1 次 dedupe_key 合并

# 演示 core（8788）
$ TMA_DATA_DIR=.../.data-demo CORE_PORT=8788 pnpm exec tsx src/index.ts
$ curl localhost:8788/api/stats
{"totalAssets":11,"todayAdded":11,"jobsByStatus":{"dead":1},...}

# 搜索：trigram FTS（≥3 字）
POST /api/search {"query":"绝命毒师"} → strategy=fts, hits=2, 2ms
   命中：绝命毒师 第五季（中文文件名）+ Breaking Bad（附言「4K 绝命毒师 在线播放」+ 标签）
# 搜索：LIKE 兜底（2 字）
POST /api/search {"query":"毒师"} → strategy=like, hits=2
# 结构化过滤
GET /api/media?quality=2160p → 3 项；GET /api/media?tag=收藏 → 1 项

# Bot 连接（真实 token + 代理）
INFO: Bot 已连接，开始长轮询  username: "Xiyuu_bot"  proxy: "on"
```

浏览器实拍（localhost:5173 指到 8788 演示库）：Dashboard 四卡 + 最近媒体 + 失败任务；Library 网格含「2 源」合并标记、时长角标、中文标题；详情页字段表/标签/来源/注解/任务记录齐全；搜索页显示策略与耗时。

## 3. 验收清单（对照 roadmap M1 八条）

- [~] 1. 归档群发视频 → 入库：**待用户关隐私模式**（根因已定位并实测确认）
- [x] 2. 样本 11 asset / 13 message：演示库输出与预期逐字一致
- [x] 3. Library 11 项 + 详情字段：浏览器实拍（真实缩略图待真机数据；演示库无文件故走占位图标分支）
- [x] 4. 中文搜索命中 + `2160p` 结构化过滤：三种路径全部实测
- [~] 5. forward 真机：代码就绪（forward/copy 双模式 + 审计 + WS 事件 + UI 弹窗），待配置目标 chat 后实测
- [x] 6. `pnpm -r typecheck && pnpm -F @tma/core test` 全绿（24 用例：去重/parser/FTS/队列/幂等）
- [x] 7. 数据持久化：seed 进程写入 → 独立 core 进程读取（跨进程验证）；core 重启逻辑已带 WAL checkpoint
- [x] 8. 本文档

## 4. 已知问题与偏离

| 项 | 说明 |
|---|---|
| Privacy Mode 阻塞 | Bot 默认隐私模式只收命令；**解法**：BotFather → Group Privacy → Turn off，或把 Bot 设为群管理员（推荐后者，免改配置） |
| Telegram 需代理 | api.telegram.org 直连超时（实测 000 / 代理 302）；已加 `TELEGRAM_PROXY_URL` 配置（grammY 走 https-proxy-agent，缩略图下载同样走代理） |
| **Token 泄漏已修复** | grammY 报错会把完整 URL（含 token）带进日志 → logger 增加全局密钥脱敏钩子（`registerSecret` + 深拷贝 sanitize，覆盖 Error.message/stack/嵌套对象）；`<br>` 曾出现在开发期终端输出中，**建议测试稳定后用 BotFather `/revoke` 轮换并更新 .env** |
| better-sqlite3 安装 | v13 的 install 脚本是遗留的 node-gyp（本机无 Python 会失败）→ pnpm `allowBuilds: better-sqlite3: false`，运行时直接用包内 `prebuilds/win32-x64.node`（已实测 FTS5 trigram 可用） |
| Vite EBUSY | cargo 写 `src-tauri/target/` 时 Vite 监听器崩溃 → `server.watch.ignored: ['**/src-tauri/**']` |
| 短查询限制 | trigram 需 ≥3 字符，2 字查询走 LIKE（覆盖 `media_search_doc` 全字段），已在 UI 说明 |
| 相册 | `media_group_id` 已记录并入库为独立媒体（与去重策略一致）；批量转发保持相册语义留到 M2 |

## 5. 下一里程碑入口（M2）

- 用户关隐私模式并转发真实样本后：复验门禁 1/2/3/5，补真实缩略图截图
- M2：MTProto 通道（mtcute）——历史扫描/断点续扫/copy 无转发头；`telegram_message.via/remote_ref` 列已预留，无需迁移
