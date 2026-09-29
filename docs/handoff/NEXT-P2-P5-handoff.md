# 接手文档 — 地基整固 P2 → P5（下一个 Agent 从这开始）

> 面向：接手本项目的下一个 Agent。本文是**任务书 + 上手指南**，读完即可开工。
> 现状：P1（地基快修）已完成（提交 `12cfb94`）；本文档覆盖 P2 / P3 / P4 / P5。
> 文档真源：`docs/architecture.md`（需求基线）· `docs/roadmap.md`（里程碑）· `docs/fix-plan.md`（本批计划）· `docs/known-issues.md`（问题清单，含用户反馈 U1-U6）。**动手前先读这四份 + 本文档。**

---

## 0. 30 秒速览

- **项目**：AI 媒体归档整理器。Telegram 存原始媒体（事实源），本地 `apps/core`（TS/Node/Fastify/SQLite）存派生数据，`apps/desktop`（Tauri + React）是工作台。
- **已完成**：归档链路（M1）、AI 富化（M3，DeepSeek 文本+视觉）、向量检索（M4，混合检索 RRF）、P1 地基快修。
- **你要做**：P2（AI 介入分流器，用户核心诉求）→ P3（分类体系+标签智能）→ P4（Desktop UI 重设计）→ P5（细节与运维）。
- **C 类全部暂缓**（MTProto/Agent/Trace/打包/批量/真实 embedding/自动重试），用户明确裁定「先修地基」。

---

## 1. 环境与启动（Windows + Git Bash）

```bash
# 每个新 shell 必须先执行（fnm 管理 Node，否则 node/pnpm 不可见）
eval "$(fnm env --shell bash)"     # Node 24.21 / pnpm 12.6

# 启动真实 core（8787，连真 Telegram + DeepSeek）
cd apps/core && pnpm dev            # tsx watch，改代码自动重启

# 启动演示 core（8788，mock AI + 假数据，用它做离线验证不烧 token）
AI_PROVIDER=mock AI_CHAT_MODEL=mock/chat AI_VLM_MODEL=mock/vision AI_EMBED_MODEL=mock/embed \
  TMA_DATA_DIR="$(pwd)/.data-demo" CORE_PORT=8788 \
  TG_BOT_TOKEN="demo:0000000000000000000000000000000000" pnpm exec tsx src/index.ts

# 启动桌面端（Tauri 窗口 + Vite 5173）
cd apps/desktop && pnpm tauri dev

# 重启演示库数据
pnpm -F @tma/core seed:demo
```

**常用校验命令**（改完必跑）：

```bash
pnpm -r typecheck                 # 三包类型检查
pnpm -F @tma/core test            # 单测（当前 63 个）
pnpm -F @tma/core smoke           # 端到端冒烟（21 项断言，临时库 + mock AI + Fastify inject）
curl -s localhost:8787/api/stats  # 真机健康
```

**杀不干净的进程**：`TaskStop` 只杀 pnpm 外壳，真正的 node/vite 进程仍在。用：

```bash
netstat -ano | grep ":8787" | grep LISTENING    # 拿 PID
taskkill //PID <pid> //F
```

---

## 2. 代码地图（只列动手要点）

| 关注点 | 位置 |
|---|---|
| 配置（zod 校验 env，fail-fast） | `apps/core/src/config.ts`（含 per-capability AI 配置、VEC_ENABLED、TELEGRAM_PROXY_URL） |
| 数据库 schema（12 表 + 迁移） | `apps/core/src/database/schema.ts`、迁移在 `apps/core/drizzle/` |
| 迁移流程 | `pnpm -F @tma/core db:generate` → 自动出 SQL；需要手写 SQL 用 `pnpm exec drizzle-kit generate --custom --name=xxx`，**语句之间必须加 `--> statement-breakpoint`**（否则迁移执行失败） |
| 应用上下文 | `apps/core/src/context.ts`（`AppContext = { config, logger, db, sqlite, bus, queue, ai }`，全项目传递这一个 ctx） |
| 事件总线 | `apps/core/src/events/bus.ts`；事件名在 `packages/shared/src/events.ts`（新增事件要两边加） |
| 作业队列 | `apps/core/src/jobs/{queue,worker}.ts`；注册处理器在 `apps/core/src/index.ts`（`worker.register(type, handler)`） |
| AI 网关（三能力独立配置） | `apps/core/src/ai/gateway.ts`（`runChat/runVision/runEmbed`、`withRun`、`recordStep`、`describe()`） |
| 富化流水线 | `apps/core/src/ai/enrich.ts`（标题策略/视觉拒答处理/标签写入都在 `applyEnrichment`） |
| 标题策略 | `apps/core/src/metadata/title-policy.ts`（`isJunkTitle` / `sanitizeAiTitle` / `cleanRuleTitle` / `deriveTitleFromDescription`） |
| 标签治理 | `apps/core/src/metadata/tag-policy.ts`（`filterTags` / `pruneAssetTags`，上限 8，来源优先级 user>rule>llm>vision） |
| 去重 | `apps/core/src/metadata/dedupe.ts` + `src/ingestion/ingest.ts`（一级 `file_unique_id`，二级 dedupe_key） |
| 检索 | `src/search/fts.ts`（FTS5 trigram）、`src/search/orchestrator.ts`（Hybrid RRF）、`src/media/queries.ts`（列表/详情） |
| API 路由 | `src/api/routes/*.ts`；统一类型 `src/api/types.ts` 的 `AppServer`；错误处理在 `src/api/server.ts`（ZodError→400） |
| Telegram 接入 | `src/telegram/client.ts`（接口）、`src/telegram/bot/{bot-client,extract,thumbnail}.ts` |
| 共享契约 | `packages/shared/src/{contracts,events}.ts`（zod + TS 类型，前端同源引用） |
| 前端 API 客户端 | `apps/desktop/src/lib/api.ts`（所有端点集中在这里） |
| 前端状态 | `src/stores/{ui,connection}.ts`（Zustand 只放 UI 偏好/连接态）；服务端数据 100% 走 TanStack Query |
| WS 失效映射 | `apps/desktop/src/hooks/useEventStream.ts`（收到事件 → invalidate 对应 query key） |
| 页面 | `src/pages/{dashboard,library,media,search,inbox,ai,settings}` |
| 脚本 | `apps/core/scripts/`（`smoke.mts` 冒烟、`seed-demo.mts` 演示库、`ai-probe/ai-check` 模型探测、`export-user-data.mts` 备份） |

**AI 目前配置**（`apps/core/.env`，勿提交）：DeepSeek `deepseek-flash`（文本）+ `deepseek-v4-flash-vision-exp`（视觉）。**无 embedding** → 语义检索目前是 mock 向量（真实 embedding 属暂缓项 C6）。

**AI 成本纪律**：真机重新富化会花 token（便宜但非零）。批量重跑前先在演示库（8788）验证；对真实库只重跑受影响的条目。

---

## 3. 工作约定（必须遵守）

1. **每阶段收口**：写 `docs/handoff/P{n}-{slug}.md`，四节：目标与结论 / 可复现命令与原始输出 / 验收逐条勾选 / 已知问题与偏离 + 下一入口。缺节视为未过门禁。
2. **测试要求**：新逻辑配单测（vitest，`*.test.ts` 与源码同目录）；涉及端到端链路的**更新 `scripts/smoke.mts` 断言**；改完跑 `pnpm -r typecheck && pnpm -F @tma/core test && pnpm -F @tma/core smoke`。
3. **提交**：中文 commit message，`feat:/fix:/docs:/chore:` 前缀，说明「为什么」。**不要 push**（用户自己决定）。不要动 git config。
4. **敏感信息**：`.env`、session、`.data*` 永不提交；日志中不得出现 token/key（`registerSecret` 已做全局脱敏，新加密钥要 `registerSecret(config.X)`）。
5. **用户偏好**（详见「全局记忆」）：中文回复；实现果断不反复求证；视觉类改动**先做出具体版本让他实机审阅**再迭代（不要停在方案描述）；不要顺手改无关模块。
6. **派生数据原则**：一切 AI 产物/索引可重建。`POST /api/admin/reindex-search` 已升级为「标签治理 + 标题清理 + 搜索文档 + hashtag 回填」的全量治理入口；新加派生数据也应接入这里。

---

## 4. 已知坑（会咬人的）

| 坑 | 说明 |
|---|---|
| sqlite-vec 主键 | `vec_media` 插入必须 `CAST(? AS INTEGER)`，普通参数绑定会报 "Only integers are allows..." |
| FTS5 trigram | 查询词 **≥3 字符**才走 FTS，2 字查询在应用层回落 LIKE（`search/fts.ts`） |
| 视觉模型是推理型 | 正文可能被推理占满 → 空输出；已做 `reasoning_content` 兜底 + max_tokens 4096 + 截断 JSON 修补。**没有任何 `{` 的输出按「拒答/说明性文本」处理**（`vision.unusable` 步骤），不算失败 |
| pnpm 12 | 构建脚本白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`；`better-sqlite3` 必须 `false`（自带 prebuilds，走 node-gyp 会因无 Python 失败） |
| Vite watch | 必须 `watch.ignored: ['**/src-tauri/**']`（否则 cargo 写 target 时 EBUSY 崩溃） |
| Drizzle 自定义迁移 | 语句间必须 `--> statement-breakpoint` |
| TypeScript | 全仓钉 **5.9.3**，勿升 TS7 |
| Telegram API | 必须走代理（`TELEGRAM_PROXY_URL=http://127.0.0.1:7890`），直连超时 |
| 前端模块缓存 | Vite 有时给旧模块（页面行为诡异先怀疑它）：touch 相关文件或强刷页面 |
| 中文经 Git Bash curl | 请求体里的中文会因编码挂掉，测中文查询用 `node --input-type=module -e "fetch(...)"` |

---

## 5. P2 — AI 介入分流器（**下一个开工项**）

**用户原话要点**（`known-issues.md` U1）：AI 是外部 API 有内容审核，敏感收藏必然被拒答。方案：**按来源群配置白/黑名单**，命中黑名单的内容**不进模型**，直接进人工分类流程；附言里的标签自动预填。示例：「转发一份日本的学习资料，Bot 发现来源群在黑名单里，就不走 AI，直接进入分类界面让用户自己归类」。

**⚠️ 已向用户说明的技术限制**：Telegram 的转发来源分四种（频道 / 群 / 用户 / 隐藏用户名），「转发自群但原发送者未隐藏」时来源是**那个人**而非群。所以设计成**多类型来源规则**（channel / chat / user / name 都能拉黑）+ 单条媒体手动开关兜底。

### 任务拆解

| # | 任务 | 实现要点 |
|---|---|---|
| P2-1 | **采集转发来源** | ① `src/telegram/types.ts` 的 `IncomingMessage` 增加 `forward?: { originType: 'user'\|'hidden_user'\|'chat'\|'channel'; chatId?: number; chatTitle?: string; chatUsername?: string; senderUserId?: number; senderName?: string }`；② `src/telegram/bot/extract.ts` 解析 grammY `Message.forward_origin`（4 种 type）+ 兼容 `forward_from_chat`/`forward_sender_name`；③ `telegram_message` 新增列 `forward_origin_type / forward_from_chat_id / forward_from_chat_title / forward_from_chat_username / forward_sender_user_id / forward_sender_name`（`db:generate` 出 0002）；④ `ingest.ts` 落库；⑤ 单测覆盖 4 种 origin |
| P2-2 | **来源策略配置** | ① settings 键 `ai_skip_sources` = `string[]`，元素为来源 key：`channel:<chatId>` / `chat:<chatId>` / `user:<userId>` / `name:<senderName>`；② `GET /api/sources/forward` → 从 `telegram_message` 聚合观察到的来源：`[{ key, type, chatId?, title?, name?, count, aiSkipped }]`；③ 设置页新卡片「来源与 AI 策略」：列表 + 每行开关（走 AI / 跳过 AI），复用 `api.patchSetting` |
| P2-3 | **分流逻辑** | ① 新建 `src/ai/routing.ts`：`resolveAiPolicy(ctx, forward): { skip: boolean; matchedKey?: string }`（按 key 匹配 skip 列表）；② `ingest.ts`：命中时**不入队** `ai.enrich`/`embedding.create`，置 `ai_status='manual'`，`bus.emit('media.manual_review', { mediaId })`（事件名加到 `packages/shared/src/events.ts`）；③ `AI_STATUSES` 常量加 `'manual'`（TS 常量，无 SQL 约束，**不需要迁移**）；④ `GET /api/inbox` 增加 `manual` 分组（shared 契约同步改 `InboxResponse`） |
| P2-4 | **人工分类界面** | ① 新端点 `POST /api/media/:id/classify`，body `{ tags: string[], category?: string, sensitive?: boolean }` → 写 user 标签（`filterTags` + `pruneAssetTags`）、`ai_status='skipped'`、audit `media.classified`；② Inbox 新增「待分类」Tab（`manual` 分组），点开弹 `ManualClassifyDialog`：缩略图 + 标题 + 来源信息 + **候选标签**（该媒体已有 rule 标签=附言 hashtag，自动勾选）+ **历史常用 user 标签 Top 10**（`GET /api/tags/top?source=user&limit=20`）+ 自由输入 + 分类 chips（P3 的六类）+ 「标记敏感」开关；③ 完成后 toast + invalidate |
| P2-5 | 单条手动开关 | 详情页动作条加「跳过 AI / 重新走 AI」小开关（直接 `PATCH /api/settings` 不合适——需要按媒体覆盖：`POST /api/media/:id/ai-policy` body `{ skip: boolean }`，存 `media_asset.ai_skip` 列或复用 `ai_status='manual'` 语义，二选一，实现时择简） |

### 验收（P2 门禁）

1. 单测：routing 匹配（4 种 key）、classify 端点行为、ingest 分流（黑名单来源 `ai_runs` 无记录）
2. `pnpm -F @tma/core smoke` 增加断言：黑名单来源入库 → `ai_status='manual'` → classify → `ai_status='skipped'` + 标签落库
3. 真机：设置页看到真实来源列表 → 拉黑一个 → 转发该来源一条 → Inbox「待分类」出现 → 手动归类 10 秒内完成
4. 文档：`docs/handoff/P2-ai-routing.md`

---

## 6. P3 — 分类体系 + 标签智能

| # | 任务 | 实现要点 |
|---|---|---|
| P3-1 | **分类体系**（用户已确认六类 + 自定义） | ① `media_asset` 新列 `category`（text）+ `is_sensitive`（integer boolean）+ `media_asset.category_source`（'rule'\|'llm'\|'user'）；② 规则映射（`src/metadata/category.ts`）：`season != null → series`；`type='photo' && media_group_id → gallery`；超时/图集启发式；③ AI 富化 prompt 增加 `category` 字段（已在返回 JSON 里，但没落库——接上）；④ 人工分类优先覆盖；⑤ `GET /api/library/sections` 返回分类夹 + 计数 + 预览图（供 P4 影音墙） |
| P3-2 | **标签压缩作业**（用户要求「让 AI 只看标签做归并」） | 新作业 `tags.consolidate`（`worker.register`）：输入该媒体**标签列表**（不含内容）→ `gateway.runChat` 输出 `{ keep: string[], drop: string[], merge: Record<string,string>, category?: string }` → 应用（保留 audit 以便追溯）；批量入口 `POST /api/admin/consolidate-tags`（入队全部）；注意：**user 标签不可被 drop/merge** |
| P3-3 | **相册聚簇** | 列表查询按 `media_group_id` 相邻渲染 + 卡片角标；`queryMedia` 需要支持按 group 排序或前端聚簇（择简） |
| P3-4 | **排序** | `GET /api/media` 支持 `sort=recent|size|duration|year|updated`（keyset 分页仅 recent 支持，其余用 offset 或前端排序——数据量小可前端） |
| P3-5 | 敏感标记 | `is_sensitive` 由 P2 人工分类 / P3 AI（成人相关标签）赋值；P4 隐私模式消费它 |

**验收**：六类计数正确；标签压缩后均值 ≤8 且可追溯；相册成组；分类夹 API 返回预览图；单测 + 冒烟更新；`docs/handoff/P3-categories-tags.md`。

---

## 7. P4 — Desktop UI 重设计（**必须用户实机审阅后迭代**）

**用户原话**：「UI 太像后端了，太像 shadcn 的设计语言，不适合一个中台应用。建议把整个 UI 和交互逻辑设计成真正适合桌面客户端体验的 UI」；对标 **Jellyfin / Emby / Apple TV** 的影视库浏览逻辑；**深色优先**（已确认）。

**方式**：先做出**一版具体实现**（不要先讨论方案）→ 请用户在 Tauri 窗口实机看完 → 按反馈多轮微调。这是用户明确的工作方式（视觉类改动）。

| # | 任务 | 要点 |
|---|---|---|
| P4-1 | 视觉基调 | 深色为主（保留浅色切换）；海报式卡片（2:3 优先，视频封面自适应）；中文正文提供**霞鹜文楷**选项（用户偏好，`index.css` 的字体变量）；应用图标替换（`tauri icon`） |
| P4-2 | 首页 | 「最近归档」横向行 + 各分类夹横向行（电影/动漫/成人/图集…）+ Hero 大图（最新一条） |
| P4-3 | 分类页 | 分类内海报网格 + 筛选（年份/分辨率/标签）+ 排序；相册成组展示；替代现在的「媒体库」平铺 |
| P4-4 | 详情页 | 海报式布局：左大图 + 右信息/操作；标签按来源分组展示；AI 摘要与视觉描述分区；文件名等确定性字段折叠 |
| P4-5 | 交互 | 悬停出操作（转发/在 Telegram 打开/设为主源）、右键上下文菜单、快捷键（`/` 搜索、`Esc` 返回）、窗口尺寸记忆 |
| P4-6 | 隐私模式（用户选「简单开关」） | 设置开关 → 开启后 `is_sensitive` 内容在首页/分类页/搜索默认隐藏（或模糊遮罩）+ 一键临时显示 |
| P4-7 | 细节收口（B5-B14） | 搜索页复用筛选器、暗色切换、转发目标下拉（Bot 记录见过的 chat）、多来源选源、相册整组转发（按 group 顺序逐条发送） |

**验收**：用户在 Tauri 窗口实机审阅通过（多轮）；关键路径（首页/分类/详情/搜索/隐私开关）无回归；`docs/handoff/P4-desktop-ui.md`（附实拍）。

**注意**：P4 改动面大，建议先做 P4-1+P4-2 的一版可看效果，再逐步补 3-7，避免一次性重写后返工。

---

## 8. P5 — 细节与运维收口

| # | 任务 | 要点 |
|---|---|---|
| P5-1 | 详情页动作 | 设为主源（`is_primary` 切换 + `preferred_message_id`）、软删除媒体（新列 `deleted_at`，列表过滤）、手动改标题（写 `canonical_title` 且不再被 AI 覆盖——加 `title_source` 或复用 `category_source` 思路） |
| P5-2 | 重新解析 | 单条 + 批量重跑规则解析（`parserVersion` 已存；升级规则后可全量重跑 → 接入 reindex） |
| P5-3 | 缩略图缓存清理 | `POST /api/admin/clear-thumbnails` + 设置页按钮 |
| P5-4 | 日志落盘 | pino 输出到文件 + 轮转（`src/logger.ts`，`pino.destination` + 按天/大小切分；注意 stdout 保留便于开发） |
| P5-5 | lint/format | 引入 oxlint 或 ESLint + Prettier（当前零配置，全靠手写规范） |
| P5-6 | 前端 ErrorBoundary | `main.tsx` 包一层，单组件异常不再整页白屏 |
| P5-7 | Bot Token 轮换 | 提醒用户 BotFather `/revoke` → 更新 `.env` → 重启（安全项，用户操作） |
| P5-8 | 运维习惯写进 README | 定期 `export:user-data`（用户标签/注解/设置不可重建）；换 embedding 模型后点「重建向量索引」；规则升级后点「重建搜索索引」 |

---

## 9. 每阶段收口流程（照做即可）

1. `pnpm -r typecheck && pnpm -F @tma/core test && pnpm -F @tma/core smoke` 全绿
2. 真机验证（8787）或用演示库（8788）验证；UI 改动**浏览器实拍**（可用 browser-use 工具截图；注意先 `localStorage.setItem('tma.coreUrl', ...)` 切库）
3. 写 `docs/handoff/P{n}-*.md`（四节：目标结论 / 命令原始输出 / 验收勾选 / 已知问题+下一入口）
4. 更新 `docs/known-issues.md`（勾掉已修项）与 `docs/fix-plan.md`（阶段状态）
5. `git add` 指定文件 → commit（中文、「为什么」导向）；**不 push**
6. 向用户汇报：做了什么 / 怎么验证 / 下一步

---

## 10. 用户反馈原文要点（避免误读）

- **U1**：AI 有内容审核，敏感内容会被拒答；要在 AI 前面加**分流器**（按来源群白/黑名单），命中的内容不进模型、直接人工分类；附言标签可预填。
- **U2**：UI 太像后台管理，要按**桌面客户端**重做成影音墙（Jellyfin/Emby/Apple TV 式）。
- **U3**：分类不能只有「类型筛选」，要**分类夹 + 多套整理逻辑**（电影/动漫/图集…）。
- **U4**：敏感内容正经处理：单独分类夹 + 隐私模式（**简单开关**，已确认）。
- **U5**：标签太满，**让 AI 只看标签做压缩归类**（不看内容）。
- **U6**：C 类全部暂缓，先把地基修好。
- 已确认决策：分类六类 + 自定义 / 深色优先 / P1-P3 自测汇报、**P4 必须用户实机审阅**。
