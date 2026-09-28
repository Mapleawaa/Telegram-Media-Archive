# 推进路线（Roadmap）

> 纪律：每个里程碑收口在 `docs/handoff/` 写一份 `M{n}-{slug}.md`，含四节 —— 目标与结论 / 可复现命令与原始输出 / 验收逐条勾选 / 已知问题与偏离 + 下一入口。缺节视为未过门禁。
> 架构稿（`docs/architecture.md`）是需求基线，偏离只追加「实施附录」，不回改正文。

## 里程碑总览

| # | 状态 | 目标 | 验收核心 | 预计 |
|---|------|------|---------|------|
| M0 | ✅ | 脚手架：pnpm workspace + 双 app 空壳 + docs 纪律 + cargo 预热 | typecheck 过、health 200、Tauri 窗口打开、git 首提交 | 1-2 天 |
| M1 | ✅ | Bot 归档 → SQLite → 桌面 Library/详情/搜索/forward（Phase 1+2 合并） | 8 条门禁全过（含真机归档/缩略图/转发，2026-09-28） | 5-8 天 |
| M2 | ⏳ 下一步 | MTProto 通道：历史扫描/续扫/copy（无转发头）、Sources 页 | 同一套 contract test 双实现全过 | 3-5 天 |
| M3 | ✅ | AI 富化：LLM 标题/摘要/标签 + 缩略图 VLM、ai_runs/steps、Inbox | 真实模型（DeepSeek）4 条媒体全部 done + mock 全链路 + 32 单测（2026-09-29） | 4-6 天 |
| M4 | — | Embedding + sqlite-vec + Hybrid 检索 + rerank | 无关键词语义查询命中；缓存不重复计费 | 3-4 天 |
| M5 | — | Agent：工具白名单 + intent + 每步 trace | 「找那个 4K 赛博朋克片发给我」端到端成功 | 4-6 天 |
| M6 | — | AI Activity 实时时间线 + Run Detail + React Flow 路径图 | WS 驱动逐步出现，无需刷新 | 3-4 天 |
| M7 | — | 打包：Node SEA sidecar 进 Tauri；Remote Core 路线文档 | 干净 Windows 无 node/pnpm 可装可用 | 4-6 天 |

## 关键决策速查

- **TG 接入**：Bot API + MTProto 双通道，`TelegramClient` 抽象两实现（M2 起 mtcute，gramjs 备选）
- **AI**：OpenAI-compatible 适配器（per-capability 模型）；当前用 **DeepSeek**（`deepseek-flash` 文本 + `deepseek-v4-flash-vision-exp` 视觉，国内直连）；硅基流动代金券模型覆盖已过期（备查）；Embedding 待 M4 另配（DeepSeek 无 embedding）
- **技术栈**：Fastify 5 · better-sqlite3 13 + Drizzle · grammY · Tauri 2 · React 19 + Vite 8 + Tailwind 4 + shadcn + TanStack Query 5 + Zustand 5 + HashRouter · pino · vitest · TypeScript 5.9.3（钉死，勿升 TS7）
- **FTS 中文**：FTS5 trigram tokenizer（无需外部 DLL），`media_search_doc` 中间表 + 触发器同步
- **去重**：`file_unique_id` 一级 + `dedupe_key`（规范化文件名|size|duration）二级
- **Core 形态**：单进程（HTTP+WS+内置 worker），绑 127.0.0.1:8787；M7 再拆 sidecar
- **dev 编排**：两个终端（`pnpm dev:core` / `pnpm dev:desktop`），core 未起时桌面端必须可用

## 环境备忘

- Git Bash 先 `eval "$(fnm env --shell bash)"`（Node 24.21 / pnpm 12.6）
- cargo 已配 rsproxy 镜像（`~/.cargo/config.toml`）
- npm 直连 npmjs 可用；慢时 `npm_config_registry=https://registry.npmmirror.com`
- pnpm 12 的构建脚本白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`（`onlyBuiltDependencies` 已失效）
- Vite 必须排除 `**/src-tauri/**` 的 watch，否则 cargo 写 target 时 EBUSY 崩溃
