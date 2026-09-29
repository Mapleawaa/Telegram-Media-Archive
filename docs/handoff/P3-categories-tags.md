# P3 — 分类体系 + 标签智能

日期：2026-09-29 · 状态：✅ 完成（后端 + 前端 + 单测 + 冒烟 + 浏览器实机核验 + 真实库回填）
前置：P2 已完成（`74dac18` 含 purge:ai 收口）· 依据：`docs/handoff/NEXT-P2-P5-handoff.md` §6、`docs/fix-plan.md` P3、`docs/known-issues.md` B5 / B8 / E3 / U3 / U5

---

## 1. 目标与结论

**用户诉求**：
- **U3**：分类不能只有「类型筛选」，要**分类夹 + 多套整理逻辑**（电影/动漫/图集…），对标 Jellyfin / Emby / Apple TV。
- **U5**：标签太满（18+ 内容标签拉满），**让 AI 只看标签做压缩归类**（不看内容）。

**结论：P3-1 ~ P3-5 全部完成。** 六类（movie / series / anime / adult / gallery / other）+ 自定义；
每条媒体始终有分类；分类夹 API 就绪（供 P4 影音墙）；标签压缩作业落地且 **user 标签受保护**。

### 1.1 分类赋值链（P3-1）

```
入库 ingest
   │  规则层（确定性，不问模型）
   ├─ type=photo            → gallery
   ├─ 文件名解析出季集        → series
   └─ 其余                   → other（六类全覆盖的兜底）
   │  · 标签含成人关键词 → is_sensitive=1
   ▼
AI 富化 enrich（prompt 的 category 字段已接上落库）
   ├─ 模型给出强分类（movie/series/anime/adult/gallery）→ 覆盖为 source='llm'
   └─ 模型给 'other'（没把握）→ **不覆盖**确定性规则（避免把 series 降级成 other）
   ▼
人工分类 classify（P2-4）/ 标签压缩
   └─ source='user' → **最高优先级，规则与 AI 都不再改动**（含 is_sensitive）
```

**关键设计决定**

1. **优先级 user > llm > rule**，用 `media_asset.category_source` 记录「是谁写的」。
   `categorySource === 'user'` 被当作「用户已接管这条的分类与敏感判断」，后续自动化一律让路。
2. **`other` 是兜底而不是空缺**：分类体系本就是六类全覆盖；让每条媒体一入库就有分类，
   AI 未跑/被分流时也不会空着（AI 跑出强分类时仍会覆盖）。
3. **AI 的 `other` 是弱信号**：不拿它覆盖 `season→series` / `photo→gallery` 这类确定性结论。
4. **规则不做语义猜测**（架构原则「确定性优先」）：判断「这部是电影还是剧集」属于语义，交 AI；
   代码只做「文件名有季集」「是图片」这种算得出来的事。
5. **标签压缩只看标签**（U5 原话）：内容不进模型——既省额度，也绕开敏感内容触发的内容审核。

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
 ✓ src/metadata/category.test.ts (13 tests)
 ✓ src/ai/consolidate.test.ts (5 tests)
 ✓ src/media/queries-p3.test.ts (5 tests)
 ✓ src/media/album-cluster.test.ts (5 tests)
 ✓ src/ai/enrich.test.ts (9)  ✓ src/ingestion/ingest.test.ts (10)
 …（共 16 文件）
 Test Files  16 passed (16)
      Tests  123 passed (123)          # P2 基线 95 → 123（+28）

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
 "titlesCleaned":0,"titlesRederived":0,"categoriesFilled":12,"tookMs":58}

$ curl -s localhost:8787/api/library/sections
total: 25
  movie 0 · series 0 · anime 0 · adult 0 · gallery 13 · other 12      # 25/25 全部分类
```

分布复核（`better-sqlite3` 只读）：

```
type × category:
  {"type":"photo","category":"gallery","src":"rule","n":13}
  {"type":"video","category":"other","src":"rule","n":12}
is_sensitive=1：9 条（成人关键词标签自动标记，如「成人向」）
seasons：真实库文件名均未解析出季集 → 无 series（符合预期）
```

> `reindex-search` 已升级：新增 `categoriesFilled` 计数与分类回填（只补空缺，不覆盖 llm/user）。

### 2.2 演示库重建（8788，mock AI）

```bash
$ AI_PROVIDER=mock … pnpm -F @tma/core seed:demo
演示库已生成：…/apps/core/.data-demo
  media_asset=12（新建 12）telegram_message=14

$ curl -s localhost:8788/api/library/sections
total: 12
  series 3 · anime 1 · gallery 2 · other 6
```

### 2.3 浏览器实机核验（Chrome + playwright-core，连演示 core 8788）

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

- [x] **P3-1 分类体系**：`src/metadata/category.ts`（`normalizeCategory` 别名归一 / `deriveRuleCategory` 确定性规则 / `applyDerivedCategory` 优先级 / `backfillRuleCategory` 回填）；**未新增任何列**（`category / category_source / is_sensitive` 已在 `0002` 建好，遵守 P2 的迁移合并决定）。
- [x] **P3-1 AI category 落库**：`buildTextPrompt` 的 `category` 字段改为六类口径（原来是 `video|photo|…` 类型枚举，重复且无用）；`applyEnrichment` 接线落库（source='llm'）。
- [x] **P3-1 人工优先覆盖**：`categorySource='user'` 后规则与 AI 都不再改动（单测覆盖）。
- [x] **P3-2 标签压缩作业**：`src/ai/consolidate.ts`（只喂标签列表 → `{keep,drop,merge,category}` → 应用）；worker 注册 `tags.consolidate`；批量入口 `POST /api/admin/consolidate-tags`；audit 事件 `media.tags_consolidated`；**user 标签不可被 drop/merge**（单测 5 例覆盖含「模型返回非 JSON」「chat 未启用」）。
- [x] **P3-3 相册聚簇**：列表查询暴露 `mediaGroupId` + `albumCount`（同组媒体数，1 = 非相册）；
  `packages/shared/src/album.ts` 提供纯函数 `clusterByAlbum`（**稳定**：不改整体相对序，只把同组成员提前到该组首次出现的位置）+ `albumSize`，
  LibraryPage 消费它做相邻渲染；卡片渲染相册角标。
- [x] **P3-4 排序**：`GET /api/media?sort=recent|updated|size|duration|year|relevance`；keyset 游标仅 recent 用，其余一次性排序；Library 页新增排序下拉。
- [x] **P3-5 分类夹 API**：`GET /api/library/sections` → 六类预设恒定出现 + 自定义分类 + 未分类，各带计数与预览图（12 条）。
- [x] **敏感标记**：`is_sensitive` 由人工分类（P2）与成人关键词标签（P3）赋值。
- [x] **单测**：123 例全绿（新增 category 13 + consolidate 5 + queries-p3 5 + album-cluster 5）。
- [x] **smoke**：41/41（新增 11 项 P3 断言）。
- [x] **UI 实机**：浏览器（Chrome）连演示 core 实际点过并截图（上表）。
- [x] **真实库回填**：25/25 有分类（不调模型）。
- [x] **文档**：本文件 + `known-issues.md` / `fix-plan.md` / `CLAUDE.md` 状态更新。

---

## 4. 已知问题与偏离 + 下一入口

### 偏离（均为实现时的判断，非缺陷）

| 项 | 说明 |
|---|---|
| `other` 兜底 | 任务书未明确「无规则时怎么办」。选**兜底 other**（而非留空）→ 满足验收「全部有分类」，也避免 P4 出现一堆「未分类」。`__none__` 分类夹仍保留（历史数据/极端情况）。 |
| `sort=recent\|relevance` 之外不支持游标 | 任务书允许「其余用 offset 或前端排序（数据量小可前端）」→ 现为**一次性排序 + 不再分页**（`nextCursor=null`）。 |
| 相册聚簇在前端 | 任务书写「按 group 排序 或 前端聚簇（择简）」→ 选**前端**：后端只暴露 `mediaGroupId/albumCount`，靠入库顺序天然相邻。 |
| `tags.consolidate` 的 run kind | 复用既有 `rerank`（`RUN_KINDS` 无更贴切的枚举，未为此加迁移）。 |
| mock 也支持标签压缩 | mock 对「标签归并」prompt 返回 `keep=全部/drop=[]/merge={}`，保证演示库不被误改，也让 P4 演示时可点。 |

### 已知问题（交给后续）

1. **真实库 12 条视频全落 `other`**：这批内容在 P1/P2 时代已富化，那时的 prompt 不返回六类分类，且文件名无季集。
   若要更准，需对它们**重新富化**（会花 token）或用「标签压缩」顺带修分类。**未擅自跑**（AI 成本纪律）。
2. **`is_sensitive` 自动标了 9 条**（成人关键词标签命中）。若用户认为过度，可调 `ADULT_KEYWORDS` 或改由人工确认——见 `known-issues.md` E1。
3. **标签压缩的 `keep` 语义**：`keep` 仅表示「不删不并」，不作为白名单（模型没提到的标签也不会被删——删除只由 `drop` 驱动）。这样更保守，避免模型漏提导致误删。
4. **相册聚簇只作用于「已加载的这一页」**：`clusterByAlbum` 在内存里对已取回的条目重排，**跨页的相册不会被拼回一起**（数据量大时要按 group 查询而非分页）。P4 影音墙如需整组展示，应按 `mediaGroupId` 单独查询。
5. **相册未做独立分组框**：只有角标 + 相邻渲染（P4 会重做展示）。

### 备注：本次会话中的并行写入

本次会话期间检测到**另一个写入者**在同一工作区产出 P3-3 相关文件
（`packages/shared/src/album.ts`、`apps/core/src/media/album-cluster.test.ts`、`apps/core/src/media/queries-p3.test.ts`，
并改写了 `apps/core/scripts/smoke.mts` 的部分断言与 `LibraryPage.tsx` 的聚簇调用）。
这些产物**自洽且全绿**（并已并入本次 P3 提交），但**并非本次执行者所写**——已在汇报中指出。

### 下一入口

**P4 — Desktop UI 重设计（影音墙）**（`NEXT-P2-P5-handoff.md` §7）：
- 消费 `GET /api/library/sections`（分类夹 + 计数 + 预览图）做首页横向行；
- 消费 `MediaListItem.category / isSensitive / albumCount / mediaGroupId`；
- 隐私模式开关消费 `isSensitive`（G7 / P4-6）。
- **P4 必须用户实机审阅后迭代**（先出具体版本，不做纯方案讨论）。
