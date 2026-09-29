# P5 — 细节与运维收口

日期：2026-09-29 · 状态：✅ 主体完成（P5-1 ~ P5-6 全部落地；B12 应用图标随 M7 打包做）
前置：P4 主体完成（`3d9490c`）· 依据：`docs/handoff/NEXT-P2-P5-handoff.md` §8、`docs/fix-plan.md` P5、`docs/known-issues.md` B6/B9/B13/B14/D1-D8
> 「地基整固」P1-P5 到此**全部收口**。

---

## 1. 目标与结论

**P5 是最后一个地基阶段**：把日常会用到的细节动作补上，把长期缺的运维件（日志/清理/lint/错误边界）立起来。

| # | 任务 | 结论 |
|---|---|---|
| **P5-1** | **B6 详情页动作** | ✅ 设为主源 / 软删除 / 手动改标题（含**标题锁定**，见下） |
| **P5-2** | **B9 重新解析** | ✅ 单条 + 批量；只跑确定性规则，不碰 AI 产物、不花 token |
| **P5-3** | **B13 转发增强** | ✅ 多来源选源 + 相册整组转发（按组内时间顺序逐条） |
| **P5-4** | **B14 转发目标下拉** | ✅ `GET /api/chats`（Bot 见过的会话，聚合自 telegram_message，**无需新表**） |
| **P5-5** | **D1/D2/D3** | ✅ 缩略图清理入口；README 补运维习惯；冒烟本就是每阶段必跑（现 48 项） |
| **P5-6** | **D4/D5/D8** | ✅ 日志按天落盘（保留 14 天）；oxlint 接入（0 警告）；前端 ErrorBoundary |
| — | B12 应用图标 | ⏸ 按原计划随 M7 打包一并做（涉及视觉产出与 tauri icon，不属于地基） |
| — | Tauri 窗口尺寸记忆 | ⏸ 需要 Rust 侧插件；本轮用「侧栏折叠 + 各类偏好持久化」替代（`tma.*`） |

### 1.1 两个关键设计决定

**① 软删除，不物理删除**

`media_asset.deleted_at`（迁移 `0003`）置位后：列表 / 分类夹 / 搜索 / 统计 / 批量作业全部排除，
作业队列里该媒体的任务也被撤掉。**但记录还在库里**——因为 Telegram 才是事实源，
本地记录只是派生数据；真删了万一哪天想找回就只能重新转发。提供 `restore` 入口可恢复。

**② 标题锁定（title_source='user'）**

手动改标题不只是「写个值」——它必须**把后续自动化挡住**，否则 AI 富化 / 规则重解析会把用户标题冲掉
（正是「人工决定优先」原则在标题上的体现，与分类的 `category_source='user'` 同理）：

- 富化（`applyEnrichment`）：`titleLocked` 时不写 AI 标题、也不清历史坏标题
- 规则重解析（`reparseAsset`）：`titleLocked` 时标题纹丝不动，**但季集等规则字段照常更新**

**③ 重解析的取数来源**

文件名不在 `telegram_message`（消息表没有该列），而在 ingest 时落库的 `media_metadata.file_name`。
所以「重解析」的语义是：**规则变了，把同一份输入重新算一遍**——而不是从 Telegram 重新取数。

---

## 2. 可复现命令与原始输出

```bash
eval "$(fnm env --shell bash)"

# ---- 三件套 ----
$ pnpm -r typecheck
packages/shared / apps/desktop / apps/core typecheck: Done

$ pnpm lint                     # 新增（P5-6 / D5，oxlint）
Found 0 warnings and 0 errors.
Finished in 55ms on 121 files with 96 rules using 16 threads.

$ pnpm -r test
 Test Files  17 passed (17)     # +reparse.test.ts（4 例）
      Tests  132 passed (132)   # P4 末 128 → 132

$ pnpm -F @tma/core smoke
  ✓ P5-1 设为主源（is_primary 与 preferred_message_id 切换）
  ✓ P5-1 手动改标题并锁定（重解析不覆盖） — 我自己的标题
  ✓ P5-1 软删除 → 列表消失 → 恢复 → 回来
  ✓ P5-3 相册整组转发（按组内顺序逐条） — count=2
  ✓ P5-4 GET /api/chats（见过会话 + 归档群标记） — 2 个 chat
  ✓ P5-2 批量规则重解析 — total=7 changed=7
  ✓ P5-5 清空缩略图缓存 — removed=1
48/48 项通过                    # P4 末 41 → 48（+7）

$ pnpm -F @tma/desktop build:web
✓ built in 1.41s
```

### 2.1 真实库（8787）

- 迁移 `0003` 已由 tsx watch 自动应用：`media_asset` 新增 `title_source` / `deleted_at`
- `GET /api/chats`：当前只有归档群一个会话（`isArchive: true`）→ 转发弹窗自动回退「手动输入 chat ID」，
  等 Bot 从其他会话收到消息后下拉就会出现（这正是 B14 设计的行为，不是缺陷）
- 日志落盘生效：`apps/core/.data/logs/core-2026-09-29.log`（JSON 行），抽查**无 token/key 泄漏**

### 2.2 浏览器实机核验（真实库，只做 DOM 断言与只读请求）

脚本：`~/.workbuddy/binaries/node/workspace/verify-p5.mjs`（9/9 通过）

```
  ✓ P5-1 有「重新解析」按钮
  ✓ P5-1 有「移出媒体库」（软删除）
  ✓ P5-1 有「手动改标题」入口
  ✓ P4-4 确定性字段/任务记录默认折叠
  ✓ P5-1 标题进入编辑态
  ✓ P5-4 转发弹窗出现（无其他 chat 时回退手动输入） — 含手动输入回退
  ✓ P5-2 设置页有「批量重解析」
  ✓ P5-5 设置页有「清空缩略图缓存」
  ✓ P4-6 设置页有「隐私模式」开关
9/9 项通过
```

> 核验刻意**不点击**任何会改数据的按钮（真实库是用户数据）；破坏性行为（软删除/恢复/重解析）
> 由冒烟 48 项在临时库上全链路验证。

截图：`docs/handoff/assets/P5/real/20~22-*.png`

---

## 3. 验收清单

- [x] **P5-1 B6 详情页动作**：设为主源（`POST /:id/primary`，事务内切 is_primary + preferred_message_id）、软删除/恢复（`deleted_at`，迁移 `0003`）、手动改标题（`title_source='user'` 锁定，富化与重解析双重守卫）
- [x] **P5-2 B9 重新解析**：单条 + 批量；新模块 `src/metadata/reparse.ts`；不碰 AI 产物；幂等（`changed=false`）
- [x] **P5-3 B13 转发增强**：多来源选源 + 相册整组转发（`ForwardRequest.album`，组内按时间排序逐条发）
- [x] **P5-4 B14 见过 chat**：`GET /api/chats`（聚合，零新表）+ 转发弹窗下拉（无其他 chat 时回退手动输入）
- [x] **P5-5 D1/D2/D3**：README 运维习惯章节；冒烟纳入每阶段流程（48 项）；`POST /api/admin/clear-thumbnails` + 设置页按钮
- [x] **P5-6 D4/D5/D8**：日志按天落盘（`<dataDir>/logs`，保留 14 天，脱敏沿用 `registerSecret`）；oxlint（`pnpm lint`，0 警告）；React ErrorBoundary
- [x] 软删除过滤覆盖：媒体库/搜索/分类夹/统计/批量重解析/标签压缩
- [x] 单测 +4（reparse：幂等 / 输入变化 / 用户锁定 / 软删跳过）
- [x] **回归**：typecheck 三包过 · lint 0 警告 · 单测 **132** · 冒烟 **48/48** · 前端 build 通过 · UI 实机 9/9
- [x] **文档**：本文件 + `fix-plan.md` / `known-issues.md` / `CLAUDE.md` / `README.md`
- [ ] B12 应用图标（随 M7 打包做）
- [ ] 用户实机体验（软删除/改标题/整组转发/目标下拉都是新交互）

---

## 4. 已知问题与偏离 + 下一入口

### 偏离（实现时的判断，非缺陷）

| 项 | 说明 |
|---|---|
| 重解析的文件名取自 `media_metadata.file_name` | 任务书说「重跑规则解析」；事实源输入就是 ingest 时存的文件名（消息表没有该列）。语义 = **规则变了重算**，不是重新从 Telegram 取数。 |
| 标题锁定用 `title_source` 而非布尔 | 任务书给了两个选项（title_source 或复用思路）。选前者：可追溯是谁最后写的标题，且 `user` 之外还能区分 rule/llm/vision。 |
| 软删除没有「回收站」页面 | 只提供 restore 入口（API + 详情页外）。目前无浏览已删条目的 UI——用户要求时再加（记录都在）。 |
| 日志轮转自实现（14 行）而不是引 pino-roll | 依赖少一个；按天切分 + 清理 14 天前的旧文件，够用。 |
| lint 用 oxlint 而非 ESLint+Prettier | 任务书写「oxlint 或 ESLint」。oxlint 单二进制、零配置、54ms 全仓扫完，先立规矩；格式化（Prettier）未引入。 |
| `/api/chats` 里归档群也返回 | 带 `isArchive` 标记，前端过滤掉。保留它对调试有用。 |

### 已知问题

1. **`/api/chats` 目前只有归档群** → 转发目标下拉回退「手动输入」。等 Bot 从其他会话收到消息后自然出现。
2. **隐私模式过滤在前端**：数据量小（百级）没问题；条数大了要改成服务端过滤，否则分页会变稀疏（已在代码注释标注）。
3. **无图卡片（如纯文本富化失败）在详情页显示「无缩略图」占位**：同 P2 已知事实。
4. **日志文件是 JSON 行**：人读不如 pino-pretty 舒服；要人读时用 `jq -r .msg` 或在 dev 模式看控制台。

### 下一入口

**「地基整固」P1-P5 全部完成。** 剩余事项（均已在计划中挂账）：
- **B12 应用图标**（随 M7 打包做）
- **C 类**：MTProto / Agent / Trace 图 / 打包 / 批量操作 / 真实 embedding / 自动重试 —— 用户裁定暂缓，等用户拍板再启
- 用户实机体验 P4/P5 的新交互，反馈驱动微调
