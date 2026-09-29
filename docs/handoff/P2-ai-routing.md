# P2 — AI 介入分流器（来源策略 / 命中不进模型 / 人工分类队列）

日期：2026-09-29 · 状态：✅ 代码完成 + 演示库实机验收通过；真机（8787）待用户转发一条确认
前置：P1 已完成（`12cfb94`）· 依据：`docs/handoff/NEXT-P2-P5-handoff.md` §5、`docs/known-issues.md` U1 / G1-G4 / A3

---

## 1. 目标与结论

**用户诉求（U1）**：AI 是外部 API、带内容审核，敏感收藏必然被拒答（A3 的根因）。要求按「来源」配白/黑名单，命中黑名单的内容**不进模型**（不审核、不打标签），直接进人工分类队列，附言 hashtag 自动预填。

**结论：P2-1 ~ P2-5 全部完成。**

核心机制：

```
转发的 Telegram 消息
   │
   ├─ forward_origin 四型 → 归一化成策略 key
   │     channel:<chatId> / chat:<chatId> / user:<userId> / name:<senderName>
   │
   ├─ ingest 时比对 settings.ai_skip_sources
   │
   ├─ 命中 → ai_status='manual' + ai_skip=1，不建任何作业，事件 media.manual_review
   │          （实测 ai_runs 记录数 0，模型完全未被调用）
   │
   └─ 未命中 → 原样入队 ai.enrich（行为与 P1 一致）
```

人工侧：设置页「来源与 AI 策略」逐来源开关 → Inbox「待分类」Tab → 分类弹窗（rule hashtag 预填 + 历史常用 user 标签 + 自定义 + 六类分类 + 标记敏感）→ `ai_status='skipped'`。
单条兜底：详情页「走 AI / 跳过 AI」开关，覆盖来源策略（解决「转发自群但原发送者未隐藏时来源是人不是群」这一 Telegram 限制）。

**关键设计决定**

1. **来源 key 用前缀区分类型**，而不是只按来源名/ID：Telegram 四种 origin 语义不同，同一个「群」与「该群里转发的人」是两个 key。单条手动开关兜底第四种之外的灰区。
2. **分流只对新建 asset 生效**：已富化的 asset 被黑名单来源二次转发时不被降级（否则会丢掉已有的 AI 产物）。
3. **用户标签不做「低价值过滤」**：`classify` 只做归一化 + 去重；用户的显式意图优先于 tag-policy 的启发式。

---

## 2. 可复现命令与原始输出

```bash
eval "$(fnm env --shell bash)"                       # Node 24.21 / pnpm 12.6

# ---- 三件套 ----
$ pnpm -r typecheck
packages/shared typecheck: Done
apps/desktop typecheck: Done
apps/core typecheck: Done

$ pnpm -F @tma/core test
 ✓ src/telegram/bot/extract.test.ts (7 tests)
 ✓ src/ai/routing.test.ts (11 tests)
 ✓ src/ingestion/ingest.test.ts (10 tests)
 ✓ src/api/routes/media-p2.test.ts (8 tests)
 … （共 12 文件）
 Test Files  12 passed (12)
      Tests  92 passed (92)          # P1 基线 63 → 92（+29）

$ pnpm -F @tma/core smoke
  ✓ 黑名单来源入库 → ai_status=manual 且不入队
  ✓ 黑名单内容不产生 ai_runs 记录 — runs=3→3
  ✓ 转发来源已落库（channel / id / 标题 / 用户名）
  ✓ GET /api/sources/forward（来源列表 + 跳过态）
  ✓ GET /api/inbox 出现「待分类」分组
  ✓ POST classify → user 标签 + 分类 + 敏感标记 + ai_status=skipped
  ✓ classify 写入 media.classified 审计
  ✓ GET /api/tags/top（历史常用 user 标签）
  ✓ POST ai-policy skip=false → 重新入队并回 pending
30/30 项通过                        # P1 基线 21 → 30（+9）

# ---- 演示库（离线、不烧 token）----
$ rm -rf apps/core/.data-demo   # 或 mv 走；seed 脚本本身已幂等
$ AI_PROVIDER=mock AI_CHAT_MODEL=mock/chat AI_VLM_MODEL=mock/vision AI_EMBED_MODEL=mock/embed \
  pnpm -F @tma/core seed:demo
演示库已生成：…/apps/core/.data-demo
  media_asset=12（新建 12）telegram_message=14

$ AI_PROVIDER=mock … TMA_DATA_DIR=…/.data-demo CORE_PORT=8788 TG_BOT_TOKEN=demo:0 \
  pnpm exec tsx src/index.ts

$ curl :8788/api/sources/forward
{"items":[
  {"key":"user:880088","type":"user","name":"考拉小姐","count":2,"skippedCount":0},
  {"key":"channel:-100111","type":"channel","chatId":-100111,"title":"影视资源频道","username":"media_channel","count":1,"skippedCount":0},
  {"key":"channel:-100555","type":"channel","chatId":-100555,"title":"云汐的文件","username":"yunxi_files","count":1,"skippedCount":1},
  {"key":"chat:-100222","type":"chat","chatId":-100222,"title":"资源分享群","count":1,"skippedCount":0},
  {"key":"name:匿名分享者","type":"name","name":"匿名分享者","count":1,"skippedCount":0}],
 "skipSources":["channel:-100555"]}

$ curl :8788/api/inbox | jq 'to_entries|map({(.key): (.value|length)})|add'
{"pending":0,"partial":0,"failed":0,"done":11,"manual":1}

$ curl ':8788/api/tags/top?source=user&limit=10'
{"items":[{"tag":"剧集","count":1},{"tag":"收藏","count":1}]}

# ---- 导出脚本（新增人工决定）----
$ TMA_DATA_DIR=…/.data-demo pnpm -F @tma/core export:user-data
  用户标签 4 条 · 注解 1 条 · 设置 3 项 · 人工分类/敏感决定 1 条
  # userDecisions[0] = {assetId:12, category:'anime', categorySource:'user', isSensitive:true, aiSkip:true}
```

### 浏览器实机截图（Chrome + playwright-core，连演示 core 8788）

| 文件 | 内容 |
|---|---|
| `docs/handoff/assets/P2/01-settings-sources.png` | 设置页「来源与 AI 策略」：5 个来源，`云汐的文件` 显示「跳过 AI」+ 关闭的开关 |
| `docs/handoff/assets/P2/03-classify-dialog.png` | 分类弹窗：来源「云汐的文件 · channel」、附言、**标签(2) 学习资料/收藏 已自动预填**、历史常用标签、六类 chips、标记敏感 |
| `docs/handoff/assets/P2/05-inbox-after-classify.png` | 分类完成 toast「2 个新标签 · 动漫 · 已标记敏感」；待分类 (0) |
| `docs/handoff/assets/P2/06-media-detail-ai-toggle.png` | 详情页动作条「跳过 AI」开关；来源卡显示「转发自频道：云汐的文件 / @yunxi_files（-100555）」 |

交互实测（脚本逐步断言 DOM 文本 + 回查 API）：

```
初始：             { aiSkip: true,  aiStatus: 'skipped' } | UI = 跳过 AI
点开（重新走 AI）： { aiSkip: false, aiStatus: 'done'    } | UI = 走 AI     # mock worker 秒级跑完
再点（跳过 AI）：   { aiSkip: true,  aiStatus: 'manual'  } | UI = 跳过 AI   # 回到待分类
```

---

## 3. 验收清单（对照 NEXT-P2-P5-handoff.md §5 与 fix-plan P2）

- [x] **P2-1 采集转发来源**：`IncomingMessage.forward` + `extractForwardOrigin`（`forward_origin` 四型 + 旧字段 `forward_from_chat`/`forward_from`/`forward_sender_name` 兼容）；`telegram_message` 新增 6 列 + 索引；`ingest` 落库（重复投递也会回填）；单测 7 例覆盖 4 型 + 旧字段 + 非转发。
- [x] **P2-2 来源策略配置**：settings `ai_skip_sources: string[]`（脏数据容错）；`GET /api/sources/forward` 聚合 `{key,type,chatId,title,username,name,count,lastSeenAt,skippedCount}` + 回显 skipSources；设置页「来源与 AI 策略」卡片，逐行「走 AI / 跳过 AI」开关（复用 `patchSetting`），空态有引导文案 + 关于 Telegram 限制的说明。
- [x] **P2-3 分流逻辑**：`src/ai/routing.ts`（`forwardSourceKey` / `resolveAiPolicy` / `getSkipSources` / `parseSourceKey`）；`ingest` 命中 → 不入队 `ai.enrich`/`embedding.create`、`ai_status='manual'`、`ai_skip=1`、事件 `media.manual_review`；`AI_STATUSES` 加 `'manual'`（纯 TS 常量，无 SQL 约束）；`GET /api/inbox` 增 `manual` 分组，shared `InboxResponse` 同步。**单测断言 `ai_runs` 记录数 0**。
- [x] **P2-4 人工分类界面**：`POST /api/media/:id/classify`（写 user 标签 + category + is_sensitive + `ai_status='skipped'` + audit `media.classified`）；`GET /api/tags/top?source=user&limit=N`；Inbox「待分类」Tab（有内容时默认选中）+ 行内「分类」按钮；`ManualClassifyDialog`：缩略图 / 标题 / 类型 / 来源（含转发来源）/ 附言 / 已预填标签（附言 hashtag，可删）/ 历史常用 user 标签 Top10 / 自定义输入 / 六类 chips / 标记敏感开关。
- [x] **P2-5 单条手动开关**：`POST /api/media/:id/ai-policy` body `{skip}`；skip=true → 撤销该媒体未完成的作业（`JobQueue.cancelForMedia`）+ `ai_status='manual'`；skip=false → `ai_status='pending'` 并重新入队 `ai.enrich`；详情页动作条开关（实测三态往返正确）。
- [x] **单测**：92 例全绿（routing 11、extract 7、ingest 分流 3、API 层 8）。
- [x] **smoke**：30/30（新增 9 项 P2 断言，含黑名单全链路 classify）。
- [x] **UI 实机**：浏览器（Chrome）连演示 core，设置页 / Inbox / 分类弹窗 / 详情页开关全部实际点过并截图。
- [x] **文档**：本文件 + `known-issues.md` / `fix-plan.md` 状态更新。
- [x] **真机（8787）来源采集 + 拉黑**：用户转发 2 条图片 → 设置页/接口看到真实来源「宅次元同人馆NSFW」→ 已拉黑 `channel:-1001666424170`（见 §5.1）。历史 23 条入库早于本次改动，`forward_*` 为空（不可回填）。
- [ ] **真机「黑名单后新转发 → 待分类」**：还需在**拉黑之后**再转发一条该来源的内容，确认它直接进 Inbox「待分类」且不产生 `ai_runs`。

---

## 4. 已知问题与偏离 + 下一入口

### 偏离（均已在实现时判定，非缺陷）

| 项 | 说明 |
|---|---|
| 迁移合并 | 任务书写「P2-1 出 0002，P3-1 再加 category/is_sensitive」。因为 P2-4 的分类 chips / 标记敏感需要落库，**已合并进 `0002_salty_the_leader.sql`**（`media_asset.category / category_source / is_sensitive / ai_skip`）。**P3 只需接规则与 AI 赋值，不要再加列**。 |
| `ai-policy` 落点 | 任务书给「`ai_skip` 列 或 复用 `ai_status='manual'`」二选一 → 选**两者并用**：`ai_skip` 记录「当前被排除在 AI 之外」的语义（详情页开关读它），`ai_status` 记录流程位置。`applyEnrichment` 在真正跑出 done/partial 时清 `ai_skip`，避免状态自相矛盾。 |
| `sources/forward` 字段名 | 任务书写 `aiSkipped`，实现为更可读的 **`skippedCount`（数值）**。 |
| 转发来源只对新建 asset 生效 | 已富化 asset 被黑名单来源二次转发时不降级（见 §1 决定 2）。 |
| `seed-demo` 幂等 | 顺手把两条用户标签插入改成 `onConflictDoNothing`（原脚本重复执行会撞唯一键）。 |

### 已知问题（交给后续阶段）

1. **分类完成后不再出现在 Inbox 任何分组**（`ai_status='skipped'` 不在四个 Tab 里）——符合任务书语义，但视觉上「内容消失」。P4 分类页 / P3 分类夹会承接这些条目。
2. **历史 23 条真实媒体的 `forward_*` 列为空**（改动前入库），且 `telegram_message.raw` 未落原始 update，无法回填。不影响新内容。
3. **`name:<senderName>` 规则较脆**：隐藏用户名的名字可被对方修改；且同名会合并。已有备注文案提示，必要时改用单条开关。
4. P2-4 弹窗里的**缩略图在演示库不显示**（假 TG 无法下载），真机正常——非缺陷。

### 下一入口

1. **真机验收（进行中）**：见 §5。
2. **P3（分类体系 + 标签智能）**：`media_asset.category / is_sensitive / category_source` 列已就绪；P3-1 只需写规则映射 + 把 AI prompt 的 `category` 字段接上落库 + 人工优先覆盖；P3-2 `tags.consolidate` 作业注意「user 标签不可 drop/merge」。

---

## 5. 真机验收 + 图片文件处理体检（2026-09-29 追加）

### 5.1 来源采集真机验证 ✅

用户在 Telegram 从「宅次元同人馆NSFW」（`@ciyuanb`）转发了 **2 条图片** 到归档群：

```
$ curl :8787/api/sources/forward
{"items":[{"key":"channel:-1001666424170","type":"channel","chatId":-1001666424170,
           "title":"宅次元同人馆NSFW","username":"ciyuanb","count":2,"skippedCount":0}],
 "skipSources":[]}
```

→ 已按用户要求拉黑：`PATCH /api/settings {ai_skip_sources:["channel:-1001666424170"]}`。
**注意**：这 2 条（#24/#25）是在拉黑**之前**转发的，所以已经走完 DeepSeek（`ai_status=done`、`extracted_by=mixed`）。黑名单只作用于此后新入库的内容。

### 5.2 图片文件处理体检（13 张 photo）

| 维度 | 结果 |
|---|---|
| 转发来源采集 | ✅ 图片与视频一视同仁，`forward_*` 正常落库 |
| 缩略图 | ✅ 13/13 有缩略图，`hasThumbnail=true`，视觉模型有图可看 |
| 确定性字段 | ✅ 正确留空（照片无 fileName/year/quality，不编造） |
| AI 富化 | ✅ 12/13 `extracted_by=mixed`（文本+视觉），双段摘要正常 |
| 标题 | ⚠️ 见下（已修） |
| 标签 | ⚠️ 见下（已修） |

**发现的两个真实质量问题（均已修复并全量治理）**

1. **中文类型词没被过滤**：13 张图里 12 张带 `图片`/`照片`/`转发图片`/`媒体归档`，还有 `未分类`/`待归档`/`来源未知` 这类占位词、`横版`/`竖图`/`横向构图` 这类可由宽高算出的方向词。P1 的低价值过滤只覆盖 ASCII（`photo|video|…`），CJK 全部漏网，白占 8 个标签配额。
   → `tag-policy.ts` 增加 CJK 精确匹配表（类型/格式词、占位词、方向词）；**刻意不收** `电影/剧集/动漫/图集/成人`——它们是 P3 的分类取值。
2. **派生标题按字数硬切**：`deriveTitleFromDescription` 原本 `slice(0,24)`，真实数据出现「肯德基爷爷化身黑帮教父，白西装坐皮椅持杖，**身后黑**」这种半截标题。
   → 改为「首句 ≤28 字完整保留；超长则**在句中标点处**断句；无标点才截断并加 `…`」。
3. 顺带修：`reindex-search` 的回填没走 `filterTags`（与 ingest 不一致），会让低价值 hashtag 反复「回填→被删」。

**治理结果（真实库，纯派生数据，未调模型）**

```
# 治理前：media_tag 200 条
$ POST /api/admin/reindex-search
{"ok":true,"count":25,"tagsAdded":3,"tagsRemoved":40,"titlesRederived":6,"tookMs":45}
# 治理后：media_tag 163 条（rule 40 / user 0），均值 6.52，最大 8

标题前后对比：
  #2  「…成人向」            → 「粉发熊帽动漫少女在夜景窗边与男子亲密接触的成人向画面」
  #15 「…坐在竹林前的石阶」   → 「…坐在竹林前的石阶上」
  #25 「…白西装坐皮椅持杖，身后黑」→ 「肯德基爷爷化身黑帮教父，白西装坐皮椅持杖」
  #20 保持不变（正好落在标点前）

标签前后对比：
  #25 云汐,恶搞梗图,悲子,柴,肯德基,表情,转发图片,黑帮教父
    → 云汐,恶搞梗图,悲子,柴,肯德基,表情,黑帮教父
  #14 JK制服,双马尾,图片,少女,户外写真,未分类,照片,竹林
    → JK制服,双马尾,少女,户外写真,竹林
```

### 5.3 图片处理仍存的缺口（未修，交后续）

| 项 | 说明 | 归属 |
|---|---|---|
| `#7` / `#18` 标题为 `null` | 这两条视觉模型没返回（拒答/无 JSON），只有文本摘要；无文件名、无规则标题 → 列表回落「图片 #7」。文本摘要形如「一张带有成人内容与性暗示标签的照片…」，当标题偏勉强 | 人工分类（P2-4 弹窗）或用户点「AI 分析」重跑；若要自动化，可在 P3 把纯 llm 的 `summary` 首句纳入标题兜底链 |
| 图片的构图/方向信息 | 现在只在标签里（已过滤），未落成结构化字段 | P3/P4 需要时可由 width/height 确定性推导 |
| 相册 | 图片仍「一图一媒体」（E2 待拍板） | P3-3 相册聚簇 |
| `reindex` 计数非零抖动 | `tagsAdded/tagsRemoved` 每次各 4：附言 hashtag 超过 8 个上限时，回填的新 id 会被 `pruneAssetTags` 再裁掉。**最终状态完全稳定**（连跑 3 次总标签恒为 163），只是计数噪声 | 低优先，不改（改动会牵动「新 rule 标签可挤掉 llm 标签」的既有语义） |
2. **P3（分类体系 + 标签智能）**：`media_asset.category / is_sensitive / category_source` 列已就绪；P3-1 只需写规则映射 + 把 AI prompt 的 `category` 字段接上落库 + 人工优先覆盖；P3-2 `tags.consolidate` 作业注意「user 标签不可 drop/merge」。
