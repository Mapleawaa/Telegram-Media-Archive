# 推进路线（Roadmap）

> 纪律：每个里程碑收口在 `docs/handoff/` 写一份 `M{n}-{slug}.md`，含四节 —— 目标与结论 / 可复现命令与原始输出 / 验收逐条勾选 / 已知问题与偏离 + 下一入口。缺节视为未过门禁。
> 架构稿（`docs/architecture.md`）是需求基线，偏离只追加「实施附录」，不回改正文。

## 当前进度（2026-09-29）

一句话：**M0 → M1 → M3 → M4 已完成，M2 未做**——即架构稿 Phase 1/2（归档+库+搜索）、Phase 3（AI 元数据）、Phase 4（向量 RAG）已落地；Phase 5（Agent）可开工。真机库 23 条媒体全部富化完成（24 个提交）。

| 已交付能力 | 状态 | 备注 |
|---|---|---|
| Bot 归档（相册/去重/幂等）、缩略图、转发/copy、审计 | ✅ | M1 真机验收 |
| 中文搜索（FTS trigram + LIKE 兜底 + 结构化过滤） | ✅ | |
| AI 富化（标题/摘要/标签 + 缩略图视觉理解 + 运行轨迹 + Inbox） | ✅ | M3，DeepSeek |
| 语义检索（sqlite-vec + 向量缓存 + RRF Hybrid 融合） | 🟡 | 管线就绪，**待接真实 embedding** |
| MTProto 历史扫描/copy 无转发头 | ⬜ | M2 |
| Agent（自然语言→工具调用）、Trace 可视化、打包 | ⬜ | M5 / M6 / M7 |

## 里程碑总览

| # | 状态 | 目标 | 验收核心 | 预计 |
|---|------|------|---------|------|
| M0 | ✅ | 脚手架：pnpm workspace + 双 app 空壳 + docs 纪律 + cargo 预热 | typecheck 过、health 200、Tauri 窗口打开、git 首提交 | 1-2 天 |
| M1 | ✅ | Bot 归档 → SQLite → 桌面 Library/详情/搜索/forward（Phase 1+2 合并） | 8 条门禁全过（含真机归档/缩略图/转发，2026-09-28） | 5-8 天 |
| M2 | ⬜ | MTProto 通道：历史扫描/续扫/copy（无转发头）、Sources 页 | 同一套 contract test 双实现全过 | 3-5 天 |
| M3 | ✅ | AI 富化：LLM 标题/摘要/标签 + 缩略图 VLM、ai_runs/steps、Inbox | 真机 23 条全部 done + mock 全链路 + 46 单测（2026-09-29） | 4-6 天 |
| M4 | ✅ | Embedding + sqlite-vec + Hybrid 检索 + rerank | sqlite-vec/缓存/融合/降级 全部单测覆盖，mock hybrid 检索 3ms；真实 embedding 待接入 | 3-4 天 |
| M5 | ⏳ | Agent：工具白名单 + intent + 每步 trace（顺带 chat 模型 rerank） | 「找那个 4K 赛博朋克片发给我」端到端成功 | 4-6 天 |
| M6 | ⬜ | AI Activity 实时时间线 + Run Detail + React Flow 路径图 | WS 驱动逐步出现，无需刷新 | 3-4 天 |
| M7 | ⬜ | 打包：Node SEA sidecar 进 Tauri；Remote Core 路线文档 | 干净 Windows 无 node/pnpm 可装可用 | 4-6 天 |

## TODO（待办池）

### A. 已发现待修（真机数据反馈）

| 优先级 | 项 | 说明 | 状态 |
|---|---|---|---|
| P1 | **垃圾标题 AI 补位** | `#20`/`video`/`1`/`2099396071722440550 0` 等文件名残留占据标题位；拟在规则标题为纯数字/通用词/文件名残留时允许 AI 标题覆盖（**待用户确认策略**） | 待确认 |
| P1 | **真实 embedding 接入** | DeepSeek 无 embedding；配 `AI_EMBED_*` 指向 Ollama `bge-m3`（免费）或硅基流动/智谱后，设置页点「重建向量索引」即可；当前语义路为 mock 向量 | 待账户/环境 |
| P2 | Bot Token 轮换 | 开发期日志曾出现完整 token（脱敏已修复）；BotFather `/revoke` 后更新 `.env` | 待用户 |
| P2 | 缩略图缓存管理 | 设置页增加「清空缩略图缓存」（当前只能手动删 `.data/thumbnails`） | 待做 |
| P3 | 标签冗余存储 | 同一标签在 media_tag 仍按来源各存一行（列表已去重显示）；是否物理合并见 M5 决策 | 观察 |
| P3 | rerank 阶段 | 计划中的 LLM rerank 未实现（随 M5 用 chat 模型做候选重排） | 随 M5 |

### B. 维护建议（运维/数据）

| 项 | 建议 |
|---|---|
| **用户生成数据备份** | `media_tag(source=user)`、`media_annotation`、`settings` 是**不可从 Telegram 重建**的数据（其余皆派生物）→ 建议加 `pnpm -F @tma/core export:user-data`（导出 JSON）并定期执行；这是目前数据安全的最大缺口 |
| 日志落盘 | core 目前只输出 stdout（终端关掉即丢）；长驻使用前应配 pino 文件输出 + 轮转（可与 M7 打包一起做） |
| 冒烟脚本 | 加 `scripts/smoke.mts`：伪造一条 ingest → enrich → embed → search → forward(dry-run) 全链路断言，改代码后一条命令回归（比单测更接近真机） |
| 定期维护 | 规则升级后点「重建搜索索引」（已实现，含标签回填）；换 embedding 模型后点「重建向量索引」；数据量上万后考虑 `VACUUM` |
| core 常驻 | 现在依赖 `pnpm dev`（终端进程）；长期归档建议 M7 打包 sidecar 或先用 Windows 计划任务 |
| 依赖升级 | TypeScript 钉 5.9.3（勿升 TS7）；drizzle/better-sqlite3 升级必须跑迁移 + FTS 重建回归 |
| 磁盘监控 | `.data/`（DB + 缩略图）随归档量增长；C 盘目前 59GB 余量，建议归档破千前检查 |

### C. 后续功能（按价值排序）

1. **M2 MTProto**：扫描频道历史批量重建（「Telegram 是事实源」原则的另一半）+ 从源频道 copy 无转发头 + Sources 页
2. **M5 Agent**：自然语言 → 工具白名单调用（search/get/find_similar/forward/annotate/tag/reindex），含候选 rerank 与执行轨迹
3. **批量操作**：媒体库多选 → 批量打标签/转发/重新分析（23 条后很快需要；相册批量转发需保持相册语义）
4. **M6 Trace UI**：AI 活动页升级为实时时间线 + React Flow 执行路径图
5. **详情页增强**：重复来源合并视图（多来源已记录）、AI 解析结果与用户标签的来源区分展示
6. **M7 打包 + Remote Core 路线**：Tauri sidecar（免 Node 环境安装）+ 远程模式文档（PostgreSQL + pgvector）

## 关键决策速查

- **TG 接入**：Bot API + MTProto 双通道，`TelegramClient` 抽象两实现（M2 起 mtcute，gramjs 备选）
- **AI**：OpenAI-compatible 适配器，**三能力各自独立配置**（`AI_CHAT_*` / `AI_VLM_*` / `AI_EMBED_*`，缺省回退 `AI_BASE_URL`/`AI_API_KEY`）；当前文本 `deepseek-flash`、视觉 `deepseek-v4-flash-vision-exp`；推理型模型注意 max_tokens 与 reasoning_content 兜底
- **检索**：structured + FTS5(trigram) + sqlite-vec 向量 → RRF 融合（Hybrid）；无 embed 配置时自动降级 FTS/LIKE
- **技术栈**：Fastify 5 · better-sqlite3 13 + Drizzle · grammY · Tauri 2 · React 19 + Vite 8 + Tailwind 4 + shadcn + TanStack Query 5 + Zustand 5 + HashRouter · pino · vitest · TypeScript 5.9.3（钉死，勿升 TS7）
- **FTS 中文**：FTS5 trigram tokenizer（无需外部 DLL），`media_search_doc` 中间表 + 触发器同步
- **去重**：`file_unique_id` 一级 + `dedupe_key`（规范化文件名|size|duration）二级
- **Core 形态**：单进程（HTTP+WS+内置 worker），绑 127.0.0.1:8787；M7 再拆 sidecar
- **dev 编排**：两个终端（`pnpm dev:core` / `pnpm dev:desktop`），core 未起时桌面端必须可用

## 环境备忘

- Git Bash 先 `eval "$(fnm env --shell bash)"`（Node 24.21 / pnpm 12.6）
- cargo 已配 rsproxy 镜像（`~/.cargo/config.toml`）
- npm 直连 npmjs 可用；慢时 `npm_config_registry=https://registry.npmmirror.com`
- pnpm 12 的构建脚本白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`（`onlyBuiltDependencies` 已失效）；better-sqlite3 必须 `false`（自带 prebuilds）
- Vite 必须排除 `**/src-tauri/**` 的 watch，否则 cargo 写 target 时 EBUSY 崩溃
- api.telegram.org 必须走代理（`TELEGRAM_PROXY_URL`，本机 7890）
- sqlite-vec 0.1.9：vec0 主键插入需 `CAST(? AS INTEGER)`；扩展加载失败会自动降级
