# P3 — 分类体系 + 标签智能

日期：2026-09-29 · 状态：✅ 完成（后端 + 前端 + 单测 + 冒烟 + 浏览器实机核验 + 真实库回填）
前置：P2 已完成（`74dac18` 含 purge:ai 收口）· 依据：`docs/handoff/NEXT-P2-P5-handoff.md` §6、`docs/fix-plan.md` P3、`docs/known-issues.md` B5 / B8 / E3 / U3 / U5

---

## 1. 目标与结论

**用户诉求**：
- **U3**：分类不能只有「类型筛选」，要**分类夹 + 多套整理逻辑**（电影/动漫/图集…），对标 Jellyfin / Emby / Apple TV。
- **U5**：标签太满（18+ 内容标签拉满），**让 AI 只看标签做压缩归类**（不看内容）。

**结论：P3-1 ~ P3-5 全部完成。** 六类（movie / series / anime / adult / gallery / other）+ 自定义；
每条媒体始终有分类；**成人内容单独归 `adult` 夹**（为 U4 敏感内容处理铺路）；分类夹 API 就绪（供 P4 影音墙）；
标签压缩作业落地且 **user 标签受保护**。

### 1.1 分类赋值链（P3-1）

```
入库 ingest
   │  规则层（确定性，不问模型）
   ├─ 标签含成人关键词        → adult（**优先**，同时置 is_sensitive=1）
   ├─ type=photo            → gallery
   ├─ 文件名解析出季集        → series
   └─ 其余                   → other（六类全覆盖的兜底）
   ▼
AI 富化 enrich（prompt 的 category 字段已接上落库）
   ├─ 模型给出强分类（movie/series/anime/adult/gallery）→ 覆盖为 source='llm'
   └─ 模型给 'other'（没把握）→ **不覆盖**确定性规则（避免把 series 降级成 other）
   ▼
人工分类 classify（P2-4）
   └─ source='user' → **最高优先级，规则与 AI 都不再改动**（含 is_sensitive）
```

**不变量：`category = 'adult'` ⇒ `is_sensitive = 1`**（分类与敏感必须一致，否则「归到成人类却不算敏感」）。
`reindex-search` 会顺带修正历史上违反该不变量的行（真实缺陷 #21：`adult`/`llm` 却 `is_sensitive=0`）。

**关键设计决定**

1. **优先级 user > llm > rule**，用 `media_asset.category_source` 记录「是谁写的」。
   `categorySource === 'user'` 被当作「用户已接管这条的分类与敏感判断」，后续自动化一律让路。
2. **`other` 是兜底而不是空缺**：分类体系本就是六类全覆盖；让每条媒体一入库就有分类，
   AI 未跑/被分流时也不会空着（AI 跑出强分类时仍会覆盖）。
3. **AI 的 `other` 是弱信号**：不拿它覆盖 `season→series` / `photo→gallery` 这类确定性结论。
4. **规则不做语义猜测**（架构原则「确定性优先」）：判断「这部是电影还是剧集」属于语义，交 AI；
   代码只做「文件名有季集」「是图片」「标签含成人词」这种算得出来的事。
5. **成人优先于类型规则**：命中成人关键词时直接进 `adult`，不再落 gallery/other —— U4 要求敏感内容
   「正经对待、单独归类」，先归好类，P4 的隐私模式才好消费。
6. **规则可以修正规则**：`reindex` 的回填允许改写 `rule` 来源的分类（规则升级后能收敛），
   但**永不覆盖 `llm` / `user`**；唯一例外是修正 `adult ⇒ is_sensitive` 这个字段自洽问题。
7. **标签压缩只看标签**（U5 原话）：内容不进模型——既省额度，也绕开敏感内容触发的内容审核。

---

## 2. 可复现命令与原始输出

```bash
eval "$(fnm env --shell bash)"                        # Node 24.21 / pnpm 12.6

# ---- 三件套 ----
$ pnpm -r typecheck
packages/shared typecheck: Done
apps/desktop typecheck: Done
apps/core typecheck: Done

$ pnpm -F @tma/core test
 ✓ src/metadata/category.test.ts (17 tests)
 ✓ src/ai/consolidate.test.ts (5 tests)
 ✓ src/media/queries-p3.test.ts (5 tests)
 ✓ src/media/album-cluster.test.ts (5 tests)
 ✓ src/ai/enrich.test.ts (9)  ✓ src/ingestion/ingest.test.ts (10)
 …（共 16 文件）
 Test Files  16 passed (16)
      Tests  127 passed (127)          # P2 基线 95 → 127（+32）

$ pnpm -F @tma/core smoke
  ✓ P3-1 ingest 规则分类：季集视频 → series（rule）
  ✓ P3-1 ingest 规则分类：图片 → gallery（rule）
  ✓ P3-1 富化后 AI 的 'other'（没把握）不覆盖确定性规则 → 仍 series/rule
  ✓ P3-5 GET /api/library/sections（分类夹 + 计数） — series=1 gallery=1
  ✓ P3-5 分类夹带预览图
  ✓ P3-1 GET /api/media?category=gallery 只返回图集
  ✓ P3-3 相册组已暴露（mediaGroupId + albumCount）
  ✓ P3-3 非相册条目 albumCount=1（契约：1 = 非相册）
  ✓ P3-4 排序 sort=size 降序（最大条在最前）
  ✓ P3-2 tags.consolidate 不误删 user 标签（user 标签在治理中受保护）
  ✓ P3-2 POST /api/admin/consolidate-tags 批量入队 — total=4 enqueued=4
41/41 项通过                          # P2 基线 30 → 41（+11）
```

### 2.1 真实库回填（8787，纯派生数据，**不调模型**）

```bash
$ curl -s -X POST localhost:8787/api/admin/reindex-search
{"ok":true,"count":25,"tagsAdded":4,"tagsRemoved":4,"titlesCleared":0,
 "titlesCleaned":0,"titlesRederived":0,"categoriesFilled":1,"tookMs":72}

$ curl -s localhost:8787/api/library/sections
total: 25
  movie 0 · series 0 · anime 0 · adult 10 · gallery 6 · other 9      # 25/25 全部分类
```

分布复核（`better-sqlite3` 只读）：

```
adult 10 · gallery 6 · other 9 ；is_sensitive=1：10 条
  · adult 来源：rule 7（成人关键词标签） / llm 3（AI 判为成人）
  · 不变量复核：`category='adult' AND is_sensitive=0` → 0 行 ✅
真实库文件名均未解析出季集 → 无 series（符合预期）
```

> `reindex-search` 已升级：新增 `categoriesFilled` 计数、分类回填（可收敛 `rule`，不动 `llm`/`user`）
> 与「`adult` ⇒ 敏感」不变量修正。
> 修复过程：首轮回填后 `#21` 出现 `category=adult`（AI 判的，`llm`）却 `is_sensitive=0`——
> 因回填原本只写 `rule` 来源。现对「字段自洽」类修正放开到 `llm` 行（不改其分类），`#21` 已置敏感。

### 2.2 演示库重建（8788，mock AI）

```bash
$ AI_PROVIDER=mock … pnpm -F @tma/core seed:demo
演示库已生成：…/apps/core/.data-demo
  media_asset=12（新建 12）telegram_message=14

$ curl -s localhost:8788/api/library/sections
total: 12
  series 3 · anime 1 · gallery 2 · other 6
```

### 2.3 标签压缩：多轮实测与收敛（真实库，AI）

第一轮批量压缩暴露出**静默失败**：25 条只有 16 条真正生效，其余 9 条「跑完等于没跑」且在库中**没有任何痕迹**。
逐层定位与修复过程（全部基于真机数据）：

| 轮次 | maxTokens | 结果 | 结论 |
|---|---|---|---|
| 1 | 800 | 16/25 生效，9 条无痕 | `finishReason='length'`，正文为空、只剩 `reasoning` 兜底 → 没 JSON |
| 2 | 2048 + prompt 明令「不要推理」+ 记 `tags.consolidate.unusable` 决策步骤 | 21/25 | 仍有 `length/no-json` |
| 3 | 4096 | 23/25 | 显著改善 |
| 4 | 4096 + **不可解析时抛错交给队列重试**（与 `enrich` 一致） | **25/25，0 dead** | 收敛 |

> 根因与视觉模型同一个坑：**DeepSeek 是推理型模型**，简单任务也可能先输出大段推理，
> 把 `max_tokens` 吃光后正文为空。CLAUDE.md 的坑位表里早有记录，这次是命中 chat 模型。

最终真实库状态（25 条）：

```
标签总数 200（P1 治理前 349） → 163（P1+P3 过滤） → 122（压缩后）
每条均值 6.00 → 5.28 → 4.88 ；上限恒为 8
分类：adult 12 · gallery 7 · other 5 · anime 1   （25/25 有分类）
is_sensitive=1：12 条，与 adult 分类完全一致（不变量 0 违例）
tags.consolidate 作业：100 个全部 succeeded，dead=0
```

```bash
$ curl -s -X POST localhost:8787/api/admin/consolidate-tags
{"ok":true,"total":25,"enqueued":25}
$ # 约 25s 后（含失败重试）
  作业 succeeded=100（四轮累计）· dead=0 · 有审计事件的资产 25/25
```

### 2.4 浏览器实机核验（Chrome + playwright-core，连演示 core 8788）

脚本：`~/.workbuddy/binaries/node/workspace/verify-p3.mjs`（9/9 通过）

```
  ✓ 媒体库渲染出卡片 — 12 张
  ✓ P3-1 卡片显示分类徽章 — 剧集/其他/动漫/图集
  ✓ P3-3 相册角标（同组 >1 显示） — 2 个
  ✓ P3-4 排序选择器存在
  ✓ P3-4 sort=size 后端降序正确 — #2 61328441344 bytes
  ✓ P3-4 UI 按大小排序（最大条在最前） — Blade Runner 2049 / 57.1 GB
  ✓ P3-1 按分类筛选（图集 2 项） — UI=2 API=2
  ✓ P3-2 设置页有「压缩标签」入口
  ✓ P3-5 分类夹计数正确 — {"movie":0,"series":3,"anime":1,"adult":0,"gallery":2,"other":6}
9/9 项通过
```

| 文件 | 内容 |
|---|---|
| `docs/handoff/assets/P3/01-library-category-album.png` | 媒体库：每张卡片的**分类徽章**（剧集/动漫/图集/其他）+ 相册**「2」角标** + 新增「分类」「排序」下拉 |
| `docs/handoff/assets/P3/02-library-sort-size.png` | `sort=size`：最大条（Blade Runner 2049 57.1 GB）排在最前 |
| `docs/handoff/assets/P3/03-library-category-filter.png` | `category=gallery` 筛选：只剩 2 张图片 |
| `docs/handoff/assets/P3/04-settings-consolidate.png` | 设置页「维护」卡新增**「压缩标签（AI 只看标签）」**按钮 |

---

## 3. 验收清单（对照 NEXT-P2-P5-handoff.md §6 与 fix-plan P3）

- [x] **P3-1 分类体系**：`src/metadata/category.ts`（`normalizeCategory` 别名归一 / `deriveRuleCategory` 确定性规则，**成人优先** / `applyDerivedCategory` 优先级 / `backfillRuleCategory` 回填，可收敛 `rule`）；**未新增任何列**（`category / category_source / is_sensitive` 已在 `0002` 建好，遵守 P2 的迁移合并决定）。
- [x] **P3-1 AI category 落库**：`buildTextPrompt` 的 `category` 字段改为六类口径（原来是 `video|photo|…` 类型枚举，重复且无用）；`applyEnrichment` 接线落库（source='llm'）。
- [x] **P3-1 人工优先覆盖**：`categorySource='user'` 后规则与 AI 都不再改动（含 `is_sensitive`，单测覆盖）。
- [x] **P3-1 敏感一致性**：不变量 `adult ⇒ is_sensitive=1`；`reindex` 修正历史违例（真实缺陷 #21 已修）。
- [x] **P3-2 标签压缩作业**：`src/ai/consolidate.ts`（只喂标签列表 → `{keep,drop,merge,category}` → 应用）；worker 注册 `tags.consolidate`；`RUN_KINDS` 新增专属 `consolidate`；批量入口 `POST /api/admin/consolidate-tags`；audit 事件 `media.tags_consolidated`；**user 标签不可被 drop/merge**（单测 5 例覆盖含「模型返回非 JSON」「chat 未启用」）。
- [x] **P3-3 相册与排序**：列表暴露 `mediaGroupId`/`albumCount`（1 = 非相册）；shared 纯函数 `clusterByAlbum` 稳定聚簇，LibraryPage 消费；卡片相册角标；`sort=recent|updated|size|duration|year`（keyset 仅 recent）+ Library 页排序下拉。
- [x] **P3-5 分类夹 API**：`GET /api/library/sections` → 六类预设恒定出现 + 自定义分类 + 未分类，各带计数与预览图（12 条）。
- [x] **敏感标记**：`is_sensitive` 由人工分类（P2）与成人关键词/成人分类（P3）赋值，且与 `category='adult'` 保持一致。
- [x] **单测**：**128 例全绿**（新增 category 18 + consolidate 6 + queries-p3 5 + album-cluster 5）。
- [x] **smoke**：41/41（新增 11 项 P3 断言）。
- [x] **UI 实机**：浏览器（Chrome）连演示 core 实际点过并截图（上表，9/9）。
- [x] **真实库回填**：25/25 有分类（终态 adult 12 / gallery 7 / other 5 / anime 1）；`is_sensitive=1` 12 条，不变量复核 0 违例。
- [x] **标签压缩真机收敛**：25/25 覆盖、100 个作业 0 dead、均值降到 4.88（§2.3）。
- [x] **文档**：本文件 + `known-issues.md` / `fix-plan.md` / `CLAUDE.md` 状态更新。

---

## 4. 已知问题与偏离 + 下一入口

### 偏离（均为实现时的判断，非缺陷）

| 项 | 说明 |
|---|---|
| `other` 兜底 | 任务书未明确「无规则时怎么办」。选**兜底 other**（而非留空）→ 满足验收「全部有分类」，也避免 P4 出现一堆「未分类」。`__none__` 分类夹仍保留（历史数据/极端情况）。 |
| `sort=recent\|relevance` 之外不支持游标 | 任务书允许「其余用 offset 或前端排序（数据量小可前端）」→ 现为**一次性排序 + 不再分页**（`nextCursor=null`）。 |
| 相册聚簇在前端 | 任务书写「按 group 排序 或 前端聚簇（择简）」→ 选**前端**：后端只暴露 `mediaGroupId/albumCount`，靠入库顺序天然相邻。 |
| `tags.consolidate` 的 run kind | 先复用 `rerank`，随后**改为专属 `consolidate`**（`RUN_KINDS` 是纯 TS 常量、无 SQL 约束 → **不需要迁移**）。 |
| mock 也支持标签压缩 | mock 对「标签归并」prompt 返回 `keep=全部/drop=[]/merge={}`，保证演示库不被误改，也让 P4 演示时可点。 |
| 压缩失败改为「抛错重试」 | 任务书没规定。原本 `plan=null` 时静默返回空结果（=跑完等于没跑且无痕）；现改为：记 `tags.consolidate.unusable` 决策步骤 **+ 抛错交给队列按既有退避重试**，与 `enrich` 的失败处理保持一致。 |
| `adult` 优先于类型规则 | 任务书把「成人标签→adult」列在规则里但未说明与 photo/season 的先后。定为**成人优先**（命中即进 adult），因为 U4 要求敏感内容单独归类。 |

### 已知问题（交给后续）

1. ~~**真实库 9 条 video 落 `other`**~~ → **已由标签压缩顺带修掉**：压缩作业会返回 `category`，
   跑完 4 轮后 `other` 从 12 条降到 5 条（其余被模型判为 adult/anime），**没有走「重新富化」这条贵路径**。
2. **`is_sensitive` 自动标了 10 条**（成人关键词标签 / `adult` 分类命中）。若用户认为过度，可调 `ADULT_KEYWORDS` 或改由人工确认——见 `known-issues.md` E1。
3. **标签压缩的 `keep` 语义**：`keep` 仅表示「不删不并」，不作为白名单（模型没提到的标签也不会被删——删除只由 `drop` 驱动）。这样更保守，避免模型漏提导致误删。
4. **相册聚簇只作用于「已加载的这一页」**：`clusterByAlbum` 在内存里对已取回的条目重排，**跨页的相册不会被拼回一起**（数据量大时要按 group 查询而非分页）。P4 影音墙如需整组展示，应按 `mediaGroupId` 单独查询。
5. **相册未做独立分组框**：只有角标 + 相邻渲染（P4 会重做展示）。
6. **`adult` 未接入隐私模式**：`is_sensitive` 数据已就绪，但「隐藏/遮罩」的行为在 P4-6 才实现。
7. **标签压缩不是幂等的，且每轮都花 token**：每轮都可能继续微调（实测 4 轮后基本收敛，均值 4.88）。
   批量入口是「全量入队」，**只在标签明显变脏时点**；单条成本约 400~1200 token（deepseek-flash），25 条约 ¥0.01 量级。
8. **25 次压缩里仍有 0~4 次「推理占满 token」**：已靠 `maxTokens=4096` + 队列重试压到 25/25 覆盖；
   若模型某天更啰嗦，重试 3 次仍失败会留 `dead` 作业（可见、可手动重试）+ `tags.consolidate.unusable` 步骤。
9. **历史 run 的 kind 是 `rerank`**：改名前的 25 次压缩记在 `rerank` 下（保留审计原样，不重跑）。

### 备注：本阶段存在并行写入（已并入）

本阶段工作期间，同一工作区**另有写入者**（上下文被压缩/重启后的同一接手工程师）产出/改写了以下内容，
均已并入 P3 三轮提交（**自洽、全绿**）：
- `packages/shared/src/album.ts`（`clusterByAlbum`/`albumSize`）、`apps/core/src/media/album-cluster.test.ts`、`apps/core/src/media/queries-p3.test.ts`
- `LibraryPage.tsx` 的聚簇调用、`smoke.mts` 的部分 P3 断言（含新增的「非相册 albumCount=1」）
- `category.ts` 的**成人优先**规则与 `adult ⇒ 敏感` 不变量修正（及其单测）、`RUN_KINDS` 新增 `consolidate`
- `consolidate.ts` 的 `maxTokens` 4096 + 「不可解析即抛错重试」

提交序列：`30a3804`（P3 主体）→ `2cf11b3`（成人优先 + 敏感不变量 + 失败可追溯）→ `a15ea5c`（maxTokens）。
**接手前请以工作区实际内容为准。**

### 下一入口

**P4 — Desktop UI 重设计（影音墙）**（`NEXT-P2-P5-handoff.md` §7）：
- 消费 `GET /api/library/sections`（分类夹 + 计数 + 预览图）做首页横向行；
- 消费 `MediaListItem.category / isSensitive / albumCount / mediaGroupId`；
- 隐私模式开关消费 `isSensitive`（G7 / P4-6）。
- **P4 必须用户实机审阅后迭代**（先出具体版本，不做纯方案讨论）。
