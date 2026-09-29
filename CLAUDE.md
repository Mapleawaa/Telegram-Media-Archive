# CLAUDE.md — Telegram Media Archive

> 本文件面向所有 AI Agent（Claude Code / Qoder / 其他）。**开工前必读**：本文件（导航与铁律）→ `docs/handoff/NEXT-P2-P5-handoff.md`（当前任务书）。

## 项目一句话

AI 媒体归档整理器：**Telegram 存原始媒体（事实源）**，本地 `apps/core`（TypeScript / Node / Fastify / SQLite）存派生数据（元数据、索引、AI 理解、审计），`apps/desktop`（Tauri 2 + React）是桌面工作台。播放仍回 Telegram。

四条不可违背的架构原则：
1. **Telegram 是事实源**——库里的一切可重建；除「用户标签/注解/设置」（用 `pnpm -F @tma/core export:user-data` 备份）。
2. **确定性优先**——能用代码算出的事（分辨率/编码/去重）绝不问 AI；AI 只做语义。
3. **AI 失败不影响归档**——AI 产物全部是派生数据，失败只影响该条富化状态。
4. **Core 与 UI 解耦**——前端只通过 REST + WS 访问 core，不碰数据库。

## 状态速览（2026-09-29）

功能里程碑 M0/M1/M3/M4 完成；当前执行「地基整固」P1-P5：**P1 ✅ → P2 ✅ → P3 ✅（2026-09-29）→ P4（下一步）** → P5。
P2 = AI 介入分流器（来源黑名单 → 不进模型 → 人工分类队列），收口见 `docs/handoff/P2-ai-routing.md`。
P3 = 分类体系（六类 + 自定义，user > llm > rule）+ 标签智能（`tags.consolidate` 只看标签），收口见 `docs/handoff/P3-categories-tags.md`。
C 类（MTProto/Agent/Trace 图/打包/批量/真实 embedding）按用户裁定**全部暂缓**。
真机库 25 条媒体（分类已全量回填：adult 12 / gallery 7 / other 5 / anime 1；`is_sensitive` 13 条；标签 122 条、均值 4.88）；真实 AI = DeepSeek（`deepseek-flash` 文本 + `deepseek-v4-flash-vision-exp` 视觉）。

## 目录结构

```
telegram-media-archive/
├─ apps/
│  ├─ core/                        # Archive Core：TS + Fastify + better-sqlite3 + Drizzle
│  │  ├─ .env / .env.example       # 配置（.env 不入库）：TG token、群 ID、代理、AI 三能力模型
│  │  ├─ drizzle/                  # SQL 迁移（0000 建表 / 0001 FTS5 自定义）
│  │  ├─ scripts/
│  │  │  ├─ smoke.mts              # 端到端冒烟（临时库+mock AI+Fastify inject，41 项断言）★改完必跑
│  │  │  ├─ seed-demo.mts          # 演示库（.data-demo，8788 端口用）
│  │  │  ├─ ai-probe.mts           # 拉取服务商模型列表 → docs/handoff/ai-models.md
│  │  │  ├─ ai-check.mts           # 模型连通性检测
│  │  │  ├─ purge-ai.mts           # 清退媒体的 AI 产物 → 退回「待分类」（存量补救）
│  │  │  └─ export-user-data.mts   # 导出不可重建的用户数据（标签/注解/设置）
│  │  └─ src/
│  │     ├─ index.ts               # 启动编排：db→bus→queue→worker→tg→server；作业注册在这
│  │     ├─ config.ts              # zod 校验 env，fail-fast；per-capability AI 配置
│  │     ├─ context.ts             # AppContext = {config,logger,db,sqlite,bus,queue,ai} 全局传递
│  │     ├─ logger.ts              # pino + 全局密钥脱敏（registerSecret）
│  │     ├─ database/              # schema.ts（12 表）/ client.ts（WAL+迁移）/ test-utils.ts
│  │     ├─ telegram/              # client.ts（TelegramClient 接口）/ types.ts（IncomingMessage）
│  │     │  └─ bot/                # bot-client.ts（grammY+代理）/ extract.ts（消息→媒体）/ thumbnail.ts
│  │     ├─ ingestion/ingest.ts    # 幂等入库事务（去重→资产→消息→标签→分类→入队→事件）
│  │     ├─ metadata/              # rule-parser（文件名解析）/ dedupe / title-policy / tag-policy
│  │     │                          # / category.ts（P3 分类：规则+优先级 user>llm>rule）
│  │     │                          # / rebuild-search-doc（搜索文档+FTS 同步）
│  │     ├─ ai/                    # types（Provider 接口）/ openai-compatible / mock
│  │     │                          # / gateway.ts（三能力路由+ai_runs/ai_steps 记账）★核心
│  │     │                          # / enrich.ts（富化流水线）/ consolidate.ts（标签压缩）
│  │     │                          # / embedding.ts（向量化+缓存）/ routing.ts（来源分流）
│  │     ├─ vector/store.ts        # sqlite-vec 封装（vec_media、KNN、维度重建）
│  │     ├─ search/                # fts.ts（FTS5 trigram+LIKE 兜底）/ orchestrator.ts（Hybrid RRF）
│  │     ├─ media/queries.ts       # 列表（keyset 分页）/详情查询 + 标题兜底链
│  │     ├─ jobs/                  # queue.ts（SQLite 队列：claim/退避/dead）/ worker.ts（轮询消费）
│  │     ├─ events/bus.ts          # 事件总线（写 audit_events + 推 WS）
│  │     ├─ settings/store.ts      # settings 键值（转发目标、AI 跳过来源等）
│  │     └─ api/                   # server.ts（Fastify 装配）/ ws.ts（WS Hub）
│  │        └─ routes/             # media / search / jobs / stats / settings / admin / ai
│  │
│  └─ desktop/                     # 桌面端：Tauri 2 + Vite + React 19 + Tailwind 4 + shadcn
│     ├─ src-tauri/                # Rust 壳（窗口/sidecar 预留）；tauri.conf.json（devUrl 5173、CSP）
│     └─ src/
│        ├─ main.tsx / App.tsx     # 入口 + HashRouter 路由表
│        ├─ lib/api.ts             # ★所有 REST 端点集中在此（前端唯一出口）
│        ├─ lib/{format,queryClient,utils}.ts
│        ├─ hooks/useEventStream.ts# WS 事件 → TanStack Query 失效映射
│        ├─ stores/{ui,connection}.ts  # Zustand：只放 UI 偏好/连接态
│        ├─ components/
│        │  ├─ layout/AppShell.tsx # 侧边导航 + 离线横幅
│        │  ├─ media/{MediaCard,ForwardDialog}.tsx
│        │  └─ ui/                 # shadcn 组件（button/card/badge/dialog/select/tabs…）
│        └─ pages/                 # dashboard / library / media / search / inbox / ai / settings
│
├─ packages/shared/                # @tma/shared：zod 契约 + TS 类型 + WS 事件名（前后端同源）
│  └─ src/{contracts,events,album,index}.ts
│
├─ docs/                           # ★文档真源（看这里，别猜）
│  ├─ architecture.md              # 需求基线（只追加实施附录，不回改正文）
│  ├─ roadmap.md                   # 里程碑 + 关键决策速查 + 环境备忘
│  ├─ fix-plan.md                  # 当前五阶段计划（P1-P5）与状态
│  ├─ known-issues.md              # 问题清单 A-E + 用户反馈 U1-U6
│  └─ handoff/                     # 各阶段收口证据 + 交接材料
│     ├─ M0-scaffold.md / M1-archive-mvp.md / M3-ai-metadata.md / M4-vector-rag.md
│     ├─ NEXT-P2-P5-handoff.md     # ★当前任务书（环境/代码地图/P2-P5/坑）
│     ├─ NEXT-AGENT-PROMPT.md      # 启动提示词（复制给新 Agent）
│     └─ ai-models.md              # 服务商模型探测结果
│
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json / .node-version
└─ .gitignore                      # 关键：.env、.data*、target、session 永不入库
```

运行期产物（不入库）：`apps/core/.data/`（真实库 archive.db + thumbnails + exports）、`apps/core/.data-demo/`（演示库）、`apps/desktop/src-tauri/target/`（Rust 构建）。

## 常用命令

```bash
eval "$(fnm env --shell bash)"        # 每个新 shell 必须（fnm 管 Node 24.21 / pnpm 12.6）

pnpm -r typecheck                      # 三包类型检查
pnpm -F @tma/core test                 # 单测（128 个）
pnpm -F @tma/core smoke                # 端到端冒烟（41 项断言）★改完必跑
pnpm -F @tma/core dev                  # 真实 core（8787）
pnpm -F @tma/desktop tauri dev         # 桌面端（自动拉起 Vite 5173）
pnpm -F @tma/core seed:demo            # 重建演示库（.data-demo）
pnpm -F @tma/core export:user-data     # 备份用户数据
pnpm -F @tma/core purge:ai 24 25       # 清退指定媒体的 AI 产物 → 退回「待分类」（存量补救，见 P2 收口 §6）
pnpm -F @tma/core db:generate          # 生成 Drizzle 迁移（自定义 SQL 用 --custom）
```

演示 core（8788，离线验证、不烧 token）：
`AI_PROVIDER=mock AI_CHAT_MODEL=mock/chat AI_VLM_MODEL=mock/vision AI_EMBED_MODEL=mock/embed TMA_DATA_DIR="$(pwd)/.data-demo" CORE_PORT=8788 TG_BOT_TOKEN="demo:0" pnpm exec tsx src/index.ts`

## UI 实机核验（无 agent-browser 时用这条）

本机没有 agent-browser，但装了 Chrome。用隔离工作区里的 `playwright-core` + 系统 Chrome 截图，**不用下载 Chromium**：

```bash
# 一次性准备（已装好，重装才需要）
mkdir -p ~/.workbuddy/binaries/node/workspace && cd ~/.workbuddy/binaries/node/workspace && npm install playwright-core
```

脚本**必须放在 `~/.workbuddy/binaries/node/workspace/` 里**（ESM 靠目录向上找 node_modules，`NODE_PATH` 对 ESM 无效），要点：

```js
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await context.addInitScript(() => localStorage.setItem('tma.coreUrl', 'http://127.0.0.1:8788')); // 切库
```

`page.evaluate(fetch(...))` 回查 core API 断言真实状态，比只看截图可靠；截图按业务页命名存 `docs/handoff/assets/P{n}/`。

## 铁律（Agent 必须遵守）

1. **收口纪律**：每个阶段写 `docs/handoff/P{n}-*.md`，四节 = 目标结论 / 可复现命令与原始输出 / 验收勾选 / 已知问题与偏离+下一入口。
2. **改完必跑**：`pnpm -r typecheck && pnpm -F @tma/core test && pnpm -F @tma/core smoke`；端到端链路改动要**同步更新 smoke 断言**。
3. **UI 改动必须实机验证**（浏览器或 Tauri 窗口）；视觉类改动先做出具体版本让用户审阅再迭代。
4. **AI 成本**：批量重新富化前先在演示库验证；真实库只跑受影响条目。
5. **Git**：中文 commit（`feat:/fix:/docs:/chore:`，写清为什么）；只 add 指定文件；**绝不 push**；**绝不改 git config**。
6. **密钥**：`.env`/session/`.data*` 永不提交；日志不得含 token/key（新密钥要 `registerSecret`）。
7. **迁移**：`drizzle-kit generate`；手写 SQL 迁移的语句间必须有 `--> statement-breakpoint`。
8. **派生数据**：新索引/派生字段要接入 `POST /api/admin/reindex-search`（现有：标签治理+标题清理+搜索文档+hashtag 回填）。

## 已知坑（会咬人）

| 坑 | 说明 |
|---|---|
| sqlite-vec 主键 | `vec_media` 插入必须 `CAST(? AS INTEGER)`，普通参数绑定报错 |
| FTS5 trigram | 查询词 ≥3 字符才走 FTS；短词应用层回落 LIKE |
| **推理型模型（DeepSeek）会吃光 token** | 不只视觉模型——**chat 模型同样会**。标签压缩实测 `maxTokens=800` 时 9/25 次推理占满预算（`finishReason='length'`）、正文为空只剩 reasoning 兜底 → 没有 JSON。对策：给足 maxTokens（4096）+ prompt 明令「不要输出思考过程」+ **不可解析时抛错交给队列重试**（别静默 no-op）。视觉侧另有截断 JSON 修补 + 「无 `{` 视为拒答/说明文本」判定 |
| pnpm 12 | 构建白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`；`better-sqlite3` 必须 `false`（自带 prebuilds，node-gyp 缺 Python 会挂） |
| Vite watch | 必须 `watch.ignored: ['**/src-tauri/**']`（否则 cargo 写 target 时 EBUSY 崩） |
| TypeScript | 全仓钉 **5.9.3**，勿升 TS7 |
| Telegram API | 必须走代理 `TELEGRAM_PROXY_URL`（本机 7890）；长轮询与 webhook 互斥 |
| 进程清理 | `TaskStop` 杀不干净子进程：`netstat -ano \| grep :8787` + `taskkill //PID <pid> //F` |
| 中文经 Git Bash curl | 请求体中文会因编码失败 → 用 `node --input-type=module -e "fetch(...)"` 测 |
| Vite 旧模块缓存 | 页面行为诡异先 touch 相关文件或强刷 |

## 端口与数据

| 服务 | 地址 | 数据 |
|---|---|---|
| 真实 core | `127.0.0.1:8787` | `apps/core/.data/archive.db`（真 Telegram + DeepSeek） |
| 演示 core | `127.0.0.1:8788` | `apps/core/.data-demo/archive.db`（mock AI） |
| Vite / 桌面 | `localhost:5173` / Tauri 窗口 | 前端 localStorage `tma.coreUrl` 决定连哪个 core |

## 下一步

**P4 — Desktop UI 重设计（影音墙）**（见 `docs/handoff/NEXT-P2-P5-handoff.md` §7）：
从「后台管理风」→「桌面影音客户端」（对标 Jellyfin / Emby / Apple TV），深色优先。
数据入口已就绪：`GET /api/library/sections`（分类夹 + 计数 + 预览图）、
`MediaListItem.category / isSensitive / albumCount / mediaGroupId`。
**P4 必须用户实机审阅后迭代**（先出具体版本，不做纯方案讨论）。
