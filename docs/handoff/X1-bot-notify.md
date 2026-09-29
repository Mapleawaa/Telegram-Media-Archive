# X1 收口 — Bot 交互与消息通知

日期：2026-09-29 · 状态：**完成**（用户指定为 P1-P5 之后的追加阶段）

## 1. 目标与结论

用户需求（原话）：

> 1. 消息通知：比如转发一个视频到群里，BOT 归档完成后，需主动向我私聊发送通知，表示加入成功，并告知添加到了哪个归类，以及有没有被 AI 整理。
> 2. 交互查询：可以在对 BOT 私聊时主动查询，比如使用 /search 等命令。

**结论：两条链路都已落地。** 通知 = 订阅 EventBus 的独立服务（不阻塞归档主链路）；
命令 = 与 grammy 解耦的纯逻辑模块（命令文本 → 回复文本，可脱离 Telegram 单测/冒烟）。

### 1.1 通知逻辑（X1-1）

```
归档群收到媒体 → ingest 入库 ──→ bus.emit('media.created')  ─┐
                 （去重合并）──→ bus.emit('media.updated',    ├→ NotifyService（订阅者）
                                  { deduped: true })        ─┤    ├─ 查 notify_chat_id（未绑定=静默）
AI 富化完成     ──────────────→ bus.emit('media.analyzed')  ─┤    ├─ 相册按 media_group_id 去抖 2s 合并
来源被拉黑      ──────────────→ bus.emit('media.manual_review')┤    ├─ 单条 300ms 微去抖（合并同资产重复）
ai.enrich 作业死 ─────────────→ bus.emit('job.failed')       ─┘    └─ BotClient.sendText() 私聊发送
```

| 触发 | 通知文案（示意） |
|---|---|
| 新媒体入库 | `📥 已归档：〈标题〉` + `类型：视频 · 分类：图集` + `🤖 AI 整理中，完成后会再通知你` |
| 相册入库 | `📥 相册已归档（8 项）` + 同上（一次通知，不刷屏） |
| 去重合并 | `🔁 与已有条目相同，已合并：〈标题〉（现在共 N 个来源）` |
| AI 完成 | `🤖 AI 整理完成（✅）` + `《AI 起的标题》` + `分类：剧集` + `标签：…` |
| 来源被拉黑 | `⏸ 进人工分类队列：〈标题〉` |
| AI 最终失败 | `⚠️ AI 整理失败（重试后仍失败）：〈标题〉` + 截断的原因（**只在 job 死亡时**，重试中不打扰） |

**绑定/解绑**：私聊 `/start` 把当前 chat id 写进 `settings.notify_chat_id`（新 setting 键，X1 新增）；
`/stop` 置 0 关闭。未绑定时所有通知静默丢弃——通知是订阅者，不是链路的必需环节。

### 1.2 命令逻辑（X1-2）

| 命令 | 行为 |
|---|---|
| `/start` | 绑定归档通知到当前私聊 + 帮助 |
| `/stop` | 解绑通知 |
| `/help` | 命令列表 |
| `/search <关键词>` | 混合检索（FTS + 向量，未配 embedding 自动降级）top 5；每条带 序号/标题/#id/分类/大小/时长/AI 标记/标签 |
| `/recent` | 最近归档 5 条 |
| `/detail <媒体ID>` | 单条详情：标题/分类/大小/画质/标签/来源列表（主源标记）/AI 状态/敏感标记 |
| `/stats` | 总数（今日 +N）/ 分类分布 / 待人工分类数 |
| `/pending` | 待人工分类（ai_status=manual）前 5 条 |
| 未知命令 / 普通文本 | 回帮助 |

实现约束（都是刻意为之）：
- `commands.ts` 的 `handleBotCommand(deps, text, fromChatId?)` **不 import grammy**——BotClient 只负责
  收发，命令逻辑可在单测/冒烟里直接调用；
- 私聊命令**不受归档群过滤**（`bot-client.ts` 的 `handle()` 在归档群过滤之前分流 `/` 开头的私聊文本）；
- 群里的命令不响应（归档群只管入库，避免刷群）；
- 回复用**纯文本**（不指定 parse_mode），标题里的 `_`/`[` 不会触发实体解析错误；
- `start()` 时 best-effort 注册 `setMyCommands` 菜单（Telegram 聊天框的菜单按钮），失败不影响归档。

## 2. 可复现命令与原始输出

```bash
$ pnpm -r typecheck && pnpm lint
apps/core typecheck: Done …（三包过；oxlint 0 警告）

$ pnpm -F @tma/core test
 Test Files  19 passed (19)
      Tests  151 passed (151)          # P5 基线 132 → 151（+19：commands 11 + notify 8）

$ pnpm -F @tma/core smoke
  ✓ X1-2 /help 列出命令
  ✓ X1-2 /stats 有总数与分类分布 — 总计 7 条（今日 +7）
  ✓ X1-2 /search 命中季集关键词 — 1. 《我自己的标题》 #1
  ✓ X1-2 /recent 列出最近归档
  ✓ X1-2 /detail 展示来源与 AI 状态
  ✓ X1-2 /detail 不存在的 id 给反馈
  ✓ X1-1 /start 绑定通知 chat
  ✓ X1-1 入库通知（归档 + 分类 + AI 状态） — 📥 已归档：#冒烟
  ✓ X1-1 AI 完成通知（新分类落库后）
  ✓ X1-1 /stop 解绑后通知静默
58/58 项通过                          # P5 基线 48 → 58（+10）
```

改动文件：

```
packages/shared/src/contracts.ts            # SETTING_KEYS.notifyChatId
apps/core/src/telegram/bot/commands.ts      # 新增：命令纯逻辑 + 绑定读写
apps/core/src/telegram/bot/commands.test.ts # 新增：11 例
apps/core/src/telegram/bot/notify.ts        # 新增：通知服务（订阅+去抖+格式化）
apps/core/src/telegram/bot/notify.test.ts   # 新增：8 例（含 fake timers 相册合并）
apps/core/src/telegram/bot/bot-client.ts    # 私聊命令分流 + sendText + setMyCommands
apps/core/src/index.ts                      # 接线 onCommand + bus.subscribe(notify)
apps/core/scripts/smoke.mts                 # +10 项 X1 断言
```

## 3. 验收逐条勾选

- [x] **归档成功主动私聊通知**：入库事件 → `📥 已归档`（冒烟 X1-1 入库通知）。
- [x] **告知归类**：通知带 `分类：〈中文标签〉`（复用 P3 的 `categoryLabel`；AI 完成的二次通知带**最终**分类）。
- [x] **告知有没有被 AI 整理**：入库时 `🤖 AI 整理中` / `⏸ 进人工分类队列` / `💤 未启用 AI`；完成后单独一条 `🤖 AI 整理完成（✅/⚠️ 部分）` 带新标题+分类+标签。
- [x] **相册不刷屏**：同组去抖 2 秒合并为一条（单测用 fake timers 验证）。
- [x] **`/search` 等私聊查询**：8 个命令全部落地，冒烟 6 项断言直接调 `handleBotCommand` 验证。
- [x] **回归**：typecheck 三包过 / lint 0 警告 / 单测 151 / 冒烟 58/58 / 前端 build 通过。
- [x] **零迁移、零新表**：通知目标复用 settings 表（新键 `notify_chat_id`）；见过会话早在 P5 就有聚合查询。

## 4. 已知问题与偏离 + 下一入口

1. **通知目标是单数**（`notify_chat_id` 一个值）：本应用定位是个人自用库，单管理员足够。
   若将来要多管理员，改成 `notify_chat_ids` 数组即可（`/start` 追加）。
2. **`/start` 在私聊才绑定**：群里的 `/start` 只回帮助不绑定（防止把归档群或无关群绑成通知目标）。
3. **AI 完成通知的标签取最近 6 个**（`rowid DESC` 取后写入的 llm/vision 标签优先）——纯展示取舍，
   不影响数据。
4. **`job.failed` 只对 `ai.enrich` 且已 dead 的作业通知**：embedding/consolidate 的失败静默（前端 AI 页可见），
   避免打扰；需要时再扩。
5. **真实 Bot 生效方式**：重启 core（或 tsx watch 自动重载）后，先私聊 Bot 发 `/start` 绑定，
   之后往归档群转发媒体即可收到通知。演示库（8788）的 token 是假值，不接入 Telegram——通知与命令要在
   **真实 core（8787）** 上体验。

### 下一入口

X1 完成。剩余挂账：B12 应用图标（随 M7 打包）、C 类（用户裁定暂缓）、
Tauri 窗口尺寸记忆（可与 M7 一起）。后续功能以用户反馈驱动。
