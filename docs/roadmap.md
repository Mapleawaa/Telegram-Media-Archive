# 推进路线（Roadmap）

> 纪律：每个里程碑收口在 `docs/handoff/` 写一份 `M{n}-{slug}.md`，含四节 —— 目标与结论 / 可复现命令与原始输出 / 验收逐条勾选 / 已知问题与偏离 + 下一入口。缺节视为未过门禁。
> 架构稿（`docs/architecture.md`）是需求基线，偏离只追加「实施附录」，不回改正文。

## 当前进度（2026-09-29）

一句话：**功能里程碑 M0/M1/M3/M4 完成；「地基整固」P1 ✅ → P2 ✅ → P3 待开工**——接手入口见 **`docs/handoff/NEXT-P2-P5-handoff.md`**，P2 收口见 `docs/handoff/P2-ai-routing.md`，计划与问题清单见 `docs/fix-plan.md` / `docs/known-issues.md`。C 类（MTProto/Agent/Trace/打包/批量/真实 embedding）按用户裁定暂缓。真机库 23 条媒体全部富化完成（P2 后**新发生**的转发会记录来源，历史条目的来源列为空）。

| 阶段 | 状态 | 内容 |
|---|---|---|
| P1 | ✅ | 地基快修：去重键 / 标题策略 / 标签治理（349→170）/ 坏标题清理 |
| P2 | ✅ | **AI 介入分流器**：来源多类型黑名单 + 命中不进模型 + 人工分类队列 + 单条开关（`docs/handoff/P2-ai-routing.md`；真机转发验收待办） |
| P3 | ⬜ | 分类体系（电影/剧集/动漫/成人/图集/其他）+ AI 标签压缩 |
| P4 | ⬜ | Desktop UI 重设计（深色影音墙，Jellyfin/Emby/Apple TV 式；必须用户实机审阅） |
| P5 | ⬜ | 细节与运维收口（主源/删除/改标题、缓存清理、日志落盘、lint、ErrorBoundary） |

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
| M5 | ⬜ 暂缓 | Agent：工具白名单 + intent + 每步 trace（顺带 chat 模型 rerank） | 「找那个 4K 赛博朋克片发给我」端到端成功 | 4-6 天 |
| M6 | ⬜ | AI Activity 实时时间线 + Run Detail + React Flow 路径图 | WS 驱动逐步出现，无需刷新 | 3-4 天 |
| M7 | ⬜ | 打包：Node SEA sidecar 进 Tauri；Remote Core 路线文档 | 干净 Windows 无 node/pnpm 可装可用 | 4-6 天 |

## TODO（待办池）

> 问题清单与待办已移到独立文档，避免两处维护漂移：
> - **待修/体验/功能/运维/决策** → `docs/known-issues.md`（编号 A1…E4 + 用户反馈 U1…）
> - **当前五阶段计划（P1-P5）与任务书** → `docs/fix-plan.md`、`docs/handoff/NEXT-P2-P5-handoff.md`

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
