# X2 收口 — 归档门控：转发后 Bot 提问「要不要 AI 审核」

日期：2026-09-29 · 状态：**完成**（用户追加阶段，替代「入库即自动 AI」的默认流程）

## 1. 目标与结论

用户原话：

> 在我将消息转发到群里后，BOT 会马上收到消息并引用这条消息，然后弹出两个按钮，
> 询问：「需要让 AI 审核这个帖子吗？」
> 1. 如果点「是」：就会进入正常的 AI 分类和归类流程。
> 2. 如果点「否」：该帖子会被标记为「其他类型」，然后进入第二个询问环节，
>    让用户主动选择归到哪一类（例如：成人、游戏、图书、其他等）。

**结论：全链路落地，且成为默认流程（`ask` 门控）。** 旧「自动 AI」保留为可选（设置页可切回）。

### 1.1 交互流

```
转发媒体进群
   │ ingest 入库（规则分类 照常：季集→series / 图片→gallery…）
   ▼
Bot 引用这条消息：「需要让 AI 审核这个帖子吗？」 [✅ 是，交给 AI] [❌ 否，手动归类]
   │                        （相册整组只弹一次，引用组内首条消息）
   ├─ 点「是」→ ai.enrich 入队（dedupeKey 防重复）→ 提示消息原地编辑为「✅ 已交给 AI 审核」
   │            → 跑完后 X1 的「🤖 AI 整理完成」私聊通知照常送达
   ├─ 点「否」→ 立即标为「其他」（category_source='user' 锁定、ai_skip=1）
   │            → 原地编辑为分类键盘：
   │              [成人] [游戏] [图书]
   │              [电影] [剧集] [动漫]
   │              [图集] [其他]
   │              [🤖 还是让 AI 审核]   ← 反悔入口
   │            → 点选后写入 user 分类，编辑为「✅ 已归类：〈分类〉」
   └─ 都不点  → 资产保持 pending（不排队、不猜测）；按钮一直有效，随时可补选
```

### 1.2 关键设计

| 决策 | 理由 |
|---|---|
| **门控模式是设置**（`ingest_gate_mode`：`ask` 默认 / `auto`） | 信任的订阅源可以切回自动；设置页「归档门控」一键切换 |
| **相册是组目标**：callback_data 带 `g:〈组号〉`，点按钮时再查全组成员 | 相册成员在 1 秒内陆续到达——按钮按下时才解析成员，晚到的也能覆盖；且 callback_data ≤64 字节（组号远小于 8 个资产 id 列表） |
| **提示去抖 1.5s 按组合并**，引用首条消息 | 8 张图的相册不弹 8 个问题 |
| **「否」只覆盖 pending/skipped 的资产** | AI 已整理完（done）的条目不被「否」降级；人工决定优先但不明改既成事实 |
| **黑名单来源不弹提问**（P2 语义不变） | 拉黑 = 明确说过的「不要 AI」，直接进人工队列 |
| **`/search` 等命令照旧可用**（X1） | 私聊命令走独立分支，互不干扰 |
| **新增 `game`（游戏）/ `book`（图书）预设分类** | 用户点名要的归类项；预设从六类变八类（分类夹/媒体库 chips/通知文案同步） |

### 1.3 状态语义表（X2 后）

| ai_status | 含义 |
|---|---|
| `pending` | ask=等用户点按钮 / auto=已排队待富化（通知文案按模式区分） |
| `skipped` | 用户点了「否」或手动归类（ai_skip=1，AI 不再碰） |
| `manual` | 来源被拉黑（P2 语义不变，不弹提问） |
| `done` / `partial` | AI 已整理（「否」按钮不会降级它） |

## 2. 可复现命令与原始输出

```bash
$ pnpm -r typecheck && pnpm lint        # 三包过；0 警告
$ pnpm -r test
 Test Files  20 passed (20)
      Tests  161 passed (161)           # X1 基线 151 → 161（+10：gate 10 例）

$ pnpm -F @tma/core smoke
  ✓ X2 默认门控为 ask
  ✓ X2 ask 门控：入库不排队、保持 pending（等用户点按钮）
  ✓ X2 分类键盘 callback_data 均可解析
  ✓ X2 点「是」→ 入队 AI 富化 — ✅ 已交给 AI 审核 · 作业 1
  ✓ X2 点「否」→ 其他（user 锁定）+ skipped
  ✓ X2 分类键盘选「游戏」→ user 分类落库
  ✓ X2 相册组一次归类覆盖全组 — A=book/skipped B=book
65/65 项通过                            # X1 基线 58 → 65（+7）

$ pnpm -F @tma/desktop build:web        # ✓ built（含 game/图书 分类 chips 与设置页门控开关）
```

改动文件：

```
packages/shared/src/contracts.ts        # CATEGORY_PRESETS +game/book；SETTING_KEYS.ingestGateMode；InlineKeyboard 类型
apps/core/src/telegram/bot/gate.ts      # 新增：目标/编解码/决策/键盘/提示去抖（与 grammy 解耦）
apps/core/src/telegram/bot/gate.test.ts # 新增：10 例
apps/core/src/telegram/bot/bot-client.ts# callback_query 处理 + sendGatePrompt（引用消息 + 按钮）
apps/core/src/telegram/bot/notify.ts    # pending 通知文案按门控模式区分（ask=等按钮）
apps/core/src/ingestion/ingest.ts       # ask 分支：不自动入队
apps/core/src/index.ts                  # 接线：入库后按需排提问 + 回调分发 + 退出清理
apps/core/src/metadata/category.ts      # 标签映射 +游戏/图书
apps/core/scripts/smoke.mts             # +7 项 X2 断言
apps/desktop/src/lib/format.ts          # 分类标签 +游戏/图书
apps/desktop/src/pages/library/LibraryPage.tsx   # 分类 chips +游戏/图书
apps/desktop/src/pages/settings/SettingsPage.tsx # 「归档门控」开关（群里问过我 / 自动 AI）
```

## 3. 验收逐条勾选

- [x] **转发后 Bot 引用消息 + 两按钮提问**：`sendGatePrompt`（reply_parameters 引用原消息 + inline keyboard）。
- [x] **「是」→ 正常 AI 分类归类**：入队 `ai.enrich`（与自动流同一管道，富化完成后 X1 通知照发）。
- [x] **「否」→ 标「其他」+ 第二轮归类键盘**：成人/游戏/图书/电影/剧集/动漫/图集/其他 + 反悔回 AI。
- [x] **相册整组一次处理**：组目标 + 1.5s 去抖 + 点按钮时解析全组成员（冒烟覆盖）。
- [x] **不点按钮的兜底**：保持 pending 不猜测；按钮永久有效；桌面端 Inbox/详情页仍可处理。
- [x] **默认启用**：`ask` 为默认模式；设置页可切回 `auto`。
- [x] **回归**：typecheck 三包 / lint 0 警告 / 单测 161 / 冒烟 65/65 / 前端 build 通过。

## 4. 已知问题与偏离 + 下一入口

1. **`pending` 的双义**（等按钮 vs 已排队）靠门控模式区分文案——资产列表里不区分。
   若将来要 UI 明示「等待选择」，需新增独立状态值（动 enum，涉及桌面端标签，暂不值得）。
2. **按钮无过期**：Telegram 的 inline 按钮一直可点；对已 done 的资产点「否」是无操作（保护性跳过）。
   若将来想要「过期自动按 auto 处理」，加一个定时任务即可（未做，等需求）。
3. **提问消息可能被删**：编辑失败只记日志（决策已落库），不影响功能。
4. **smoke 的教训**（已修）：`makeMsg` 默认 `messageId: 1`，新增用例必须覆写唯一 id，否则触发
   （chat, message）唯一约束判重 → 全部并成一条，断言互相污染。
5. **验证边界**：提问的「发送/编辑」在真实 Bot 上才有（冒烟环境无 Telegram）；按钮决策的
   数据效果由单测 + 冒烟全链路覆盖。**实机体验**：真实 core 已热重载，转发一条媒体进群即可看到提问。

### 下一入口

X2 完成。挂账不变：B12 应用图标（随 M7 打包）、C 类（暂缓）、后续以实机反馈驱动。
