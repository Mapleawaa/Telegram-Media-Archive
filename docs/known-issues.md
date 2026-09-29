# 待修清单（Known Issues）

> 用途：收集开发/自测/使用中发现的全部问题，按编号引用，用于排修复计划。
> 状态标记：🔴 明确 bug ｜ 🟡 体验缺口 ｜ 🔵 功能缺位 ｜ ⚪ 工程/运维 ｜ ✅ 已修复
> 维护规则：修完不删除，标 ✅ 并注明提交号；用户补充的问题追加到「用户反馈」区。

## A. 明确 Bug（代码缺陷）

| ID | 优先级 | 问题 | 位置 / 现状 | 状态 |
|---|---|---|---|---|
| A1 | **P1** | 🔴 无文件名资产的二级去重键退化为「仅大小」：照片（无 file_name）的 `dedupe_key` 会因同字节数错误合并 | `src/metadata/dedupe.ts` + `ingest.ts` | ✅ 已修：无文件名时 `dedupe_key = nouid:<file_unique_id>`（不参与二级去重）+ 单测 |
| A2 | P2 | 🔴 视觉 JSON 被 max_tokens 截断 → 解析失败标记 partial | `src/ai/enrich.ts` | ✅ 已修（dca4406）：`repairTruncatedJson` + max_tokens 4096 |
| A3 | P2 | 🔴 内容审核拒答被当失败（措辞多样，关键词法漏判） | `src/ai/enrich.ts` | ✅ 已修（dca4406）：`vision.unusable` 步骤；**根治见 P2 分流器**（2026-09-29）：命中「跳过 AI」来源的内容根本不进模型，不再产生拒答 |
| A4 | P2 | 🔴 同标签多来源重复显示（`cos, cos`） | 列表查询/搜索文档 | ✅ 已修（dca4406）：`group_concat(DISTINCT)` + Set 去重 |
| A5 | P3 | 🟡 任务「重试」按钮不主动失效查询缓存 | `DashboardPage.tsx` | ✅ 已修：`onSuccess → invalidateQueries()` |
| A6 | P3 | 🟡 对已完成媒体点「AI 分析」会立刻置回 `pending`，列表项跳动 | `routes/ai.ts` | ⚪ 保持现状（语义正确，toast 已提示；待分类体系上线后随 UI 重做） |
| A7 | P3 | 🟡 早期 run 的 `totalTokens` 为 null（修复前记录） | 历史数据 | ⚪ 忽略（价值低） |
| A8 | P1 | 🔴 历史坏标题落库：模型拒答句被当标题（如「图片涉及露骨色情内容，无法生成归档描述」） | `enrich.ts` + `admin.ts` | ✅ 已修：`sanitizeAiTitle` 校验 AI 标题 + reindex 清理历史坏标题 |

## B. 体验/UI 缺口

| ID | 优先级 | 问题 | 现状 | 建议 |
|---|---|---|---|---|
| B1 | **P1** | 🔴 详情页不显示原始文件名 | `MediaDetailPage.tsx` | ✅ 已修：字段表新增「文件名」行（可复制） |
| B2 | **P1** | 🔴 照片类无标题 → 列表显示 `#18`；视觉描述没被用上 | 11 张照片全部无 fileName/canonicalTitle | ✅ 已修：`deriveTitleFromDescription`（视觉描述首句 24 字）+ 展示兜底链 `类型 #id` |
| B3 | **P1** | 🔴 垃圾标题：`video`、`1`、`2099396071722440550 0`、纯数字文件名 | 规则标题优先占位 | ✅ 已修：`isJunkTitle` 判定 + AI 标题补位；真机 19/23 标题可读，其余回落「类型 #id」 |
| B4 | **P1** | 🟡 标签噪声：23 条 349 个标签（≈15/条） | `media_tag` | ✅ 已修：`tag-policy`（过滤/归一/多来源去重/上限 8）→ 真机 170 个（均值 7.4） |
| B4b | P2 | 🟡 文件名/标题带推广尾巴（`电报TG@xxx`） | 规则标题 | ✅ 已修：`cleanRuleTitle`（剥句柄/短链）+ reindex 清理 4 条历史数据 |
| B4c | P2 | 🟡 中文低价值标签没人管（`图片`/`照片`/`转发图片`/`未分类`/`待归档`/`横版`/`竖图`…） | `tag-policy.ts` 原过滤表只覆盖 ASCII | ✅ 已修（2026-09-29）：增 CJK 精确匹配表（类型/占位/方向词）+ reindex；真机 200 → 163 条，均值 6.52 |
| B3b | P2 | 🟡 派生标题按 24 字硬切，出现「…白西装坐皮椅持杖，身后黑」半截标题 | `deriveTitleFromDescription` | ✅ 已修（2026-09-29）：改为按句中标点断句（上限 28 字）+ reindex 重生成 6 条历史标题 |
| B5 | P2 | 🟡 相册（`media_group_id` 已记录）在网格中未相邻渲染、无相册标记 | `queries.ts` 未用该字段 | ✅ 已修（P3-3）：列表暴露 `mediaGroupId`/`albumCount`，卡片渲染相册角标 |
| B6 | P2 | 🟡 无法修改主来源（星标只读）、无法删除媒体、无法手动改标题 | 详情页 | 加「设为主源」「删除（软删）」「编辑标题」三个动作 |
| B7 | P2 | 🟡 搜索页无筛选器（Library 有，未复用） | `SearchPage.tsx` | 复用 Library 的筛选组件 |
| B8 | P2 | 🟡 媒体库无排序切换（只有「最新」；搜索态是相关性） | `queries.ts` order 参数仅 recent/relevance | ✅ 已修（P3-4）：`sort=recent\|updated\|size\|duration\|year` + Library 页排序下拉 |
| B9 | P2 | 🟡 详情页缺「重新解析（规则）」动作（`parserVersion` 已存但无入口） | 计划 M1 提到 | 单条 + 批量重解析规则 |
| B10 | P3 | 🟡 深色模式未接入（CSS 有 `.dark` 变量，无切换开关） | `index.css` | 加主题切换（跟随系统/手动） |
| B11 | P3 | 🟡 中文正文字体为 Geist 回退字体；用户偏好霞鹜文楷（LXGW WenKai） | `index.css` | 提供「文楷」字体选项（本地打包字体或 CDN） |
| B12 | P3 | 🟡 应用图标仍是 Tauri 默认图标 | `src-tauri/icons/` | 生成/替换应用图标（M7 打包前一并做） |
| B13 | P3 | 🟡 转发弹窗：不支持相册一次性转发、不支持多来源时选源、失败无自动重试 | `ForwardDialog.tsx` | 相册按 group 顺序逐条发送（M2 一并） |
| B14 | P3 | 🟡 转发目标 chat 需要手填 ID（引导文案有，但拿到 ID 仍不方便） | 设置页/弹窗 | Bot 记录「见过的 chat」列表（归档群除外）供下拉选择 |

## C. 功能缺位（原计划内）——⏸ 全部暂缓（用户裁定 2026-09-29：先把地基修好）

| ID | 里程碑 | 内容 | 现状 |
|---|---|---|---|
| C1 | M2 | MTProto 双通道：扫频道历史 / 断点续扫 / copy 无转发头 / Sources 页 | ⏸ 暂缓 |
| C2 | M5 | Agent：自然语言 → 工具白名单调用 + 候选 rerank + 执行轨迹 | ⏸ 暂缓 |
| C3 | M6 | AI Activity 实时时间线 + React Flow 执行路径图 | ⏸ 暂缓 |
| C4 | M7 | 打包（Tauri sidecar + Node SEA）+ Remote Core 路线文档 | ⏸ 暂缓 |
| C5 | 新增 | 批量操作：多选打标签 / 批量转发 / 批量重新分析 | ⏸ 暂缓 |
| C6 | M4 收尾 | 真实 embedding 接入 → 语义检索当前为 mock 向量 | ⏸ 暂缓 |
| C7 | 新增 | 失败任务自动重试/定时重试 | ⏸ 暂缓 |
| C8 | 架构稿 §29/30 | Telegram 回复上下文（reply → `current_media_id`） | ⏸ 暂缓 |

## D. 工程/运维

| ID | 优先级 | 问题 | 现状 | 建议 |
|---|---|---|---|---|
| D1 | **P1** | 用户数据无备份（用户标签/注解/设置**不可从 Telegram 重建**） | 脚本已跑通（P2 顺带验证）；并已把 P2 新增的人工决定（`category`/`is_sensitive`/`ai_skip`）纳入 `userDecisions` 段 | 余：写进 README 习惯指引（归 P5-8） |
| D2 | **P1** | 缺一键回归 | 冒烟脚本已写（`scripts/smoke.mts`，含 18 项断言），**尚未跑通验证**（LOG_LEVEL 修正后被打断） | 跑通并纳入「改完代码必跑」流程 |
| D3 | P2 | 缩略图缓存无清理入口 | 只能手删 `.data/thumbnails` | 加 API + 设置页按钮（维护三件套之一，未做） |
| D4 | P2 | 日志只输出 stdout，无文件与轮转 | `logger.ts` | 加文件输出 + 按天/大小轮转（可与 M7 一起） |
| D5 | P3 | 无 lint/format 配置（无 ESLint/Prettier/EditorConfig） | 全靠手写规范 | 引入 oxlint 或 ESLint + Prettier（低成本高收益） |
| D6 | P2 | Bot Token 曾出现在开发日志中，未轮换 | 安全项 | BotFather `/revoke` → 更新 `.env` → 重启 core |
| D7 | P2 | core 常驻依赖终端（关终端即停） | 现状 | 短期用 Windows 计划任务；长期 M7 打包 sidecar |
| D8 | P3 | 前端无错误边界（单组件异常可能整页白屏） | `main.tsx` 无 ErrorBoundary | 加全局 ErrorBoundary + 友好提示 |
| D9 | P3 | DB 体积管理（VACUUM）与磁盘监控 | 当前小 | 破万条后加定期 VACUUM；设置页显示 DB/缓存占用 |
| D10 | P3 | 无 CI / git hooks | 本地单人开发 | 可选：pre-commit 跑 typecheck + 单测 |

## E. 数据质量 / 产品决策（需你拍板）

| ID | 问题 | 说明 |
|---|---|---|
| E1 | 敏感内容标签 | 视觉模型对成人内容拒答已优雅处理；但 llm/vision 仍可能输出「色情/露骨」类标签。是否希望保留、屏蔽、或单独归类？**P3 追加**：命中成人关键词/`adult` 分类的内容自动置 `is_sensitive`（真实库 10 条）；若觉得过度，可调 `src/metadata/category.ts` 的 `ADULT_KEYWORDS`。 |
| E2 | 相册语义 | 现在相册里每张图 = 独立媒体（与去重策略一致）。是否希望「一个相册 = 一个媒体（含多图）」？**P3 现状**：只做「相邻渲染 + 角标」（P3-3），未改「一图一媒体」的去重语义。 |
| E3 | 标签密度 | 建议把每条媒体标签上限压到 5-8 个并过滤低价值词（同 B4），是否同意？ ✅ 已做（上限 8，P1；P3-2 追加「AI 只看标签」的压缩归并作业） |
| E4 | 来源群名入标签 | AI 把来源群名（如「云汐的文件」）当标签。建议统一过滤群名/来源类词，是否同意？ ✅ 已做（P1 群名 + 2026-09-29 补中文类型/占位/方向词） |
| E5 | 图片类媒体的标题缺口 | 纯文本富化（视觉拒答）的图片无标题、也无文件名 → 列表回落「图片 #7」。#7/#18 仍如此。是否同意「把 llm 摘要首句纳入标题兜底链」？ |

## F. 用户反馈新增（2026-09-29）——本批修复的主线

| ID | 主题 | 说明 |
|---|---|---|
| U1 | **AI 介入分流器（白/黑名单）** | ✅ **已实现（P2，2026-09-29）**：来源 key 支持 channel/chat/user/name 四种（原因是 Telegram 转发来源分四型，「转发自群但原发送者未隐藏」时来源是人不是群），命中即不进模型、进人工分类队列，附言 hashtag 自动预填；另加单条「跳过 AI」开关兜底。见 `docs/handoff/P2-ai-routing.md`。真机验收待用户转发内容后完成。 |
| U2 | **Desktop UI 重设计** | 现在太像后台管理界面（shadcn 默认语言），不像桌面客户端。要求按**桌面影音客户端**重做 UI 与交互逻辑。 |
| U3 | **分类体系（对标 Jellyfin/Emby/Apple TV）** | ✅ **已实现（P3-1/P3-5，2026-09-29）**：六类 + 自定义，规则/AI/人工三级赋值（user 最高优先），`GET /api/library/sections` 分类夹 + 计数 + 预览图。见 `docs/handoff/P3-categories-tags.md`。 |
| U4 | **敏感内容处理** | 收藏级内容要正经对待：敏感内容单独归类（分类夹），并支持**隐私模式**（设置里开启后隐藏/遮罩）。**P3 已备好数据**（`is_sensitive` 自动标记）；隐私模式 UI 归 P4-6。 |
| U5 | **AI 标签压缩归类** | ✅ **已实现（P3-2，2026-09-29）**：`tags.consolidate` 作业只输入标签列表（不看内容）→ 归并/去冗余；`POST /api/admin/consolidate-tags` 批量入队；设置页有入口；**user 标签不可被删/并**。 |
| U6 | 范围裁定 | **C 类（C1-C8）全部暂缓**；B5-B14 属前端实现细节，随 UI 重设计一并处理；D 类（工程运维）没有问题照做。 |

## G. 新增功能工作流（由 U1-U5 展开）

| ID | 内容 | 依赖 |
|---|---|---|
| G1 | 采集转发来源（`forward_origin`：来源群 ID/标题/用户名、转发时间）→ 新列 + 迁移 | ✅ 完成（P2-1，迁移 `0002`；`telegram_message.forward_*`） |
| G2 | 来源策略配置：观察到的来源列表 + 每个来源「走 AI / 跳过 AI」开关（设置页） | ✅ 完成（P2-2，`GET /api/sources/forward` + 设置页「来源与 AI 策略」） |
| G3 | 分流逻辑：ingest 时命中跳过策略 → 不入队 ai.enrich，`ai_status='manual'` 进「待分类」队列 | ✅ 完成（P2-3，`src/ai/routing.ts`；实测 ai_runs 0 记录） |
| G4 | 人工分类界面：待分类队列 + 分类面板（附言 hashtag 预填、常用分类 chips、自由标签、标记敏感） | ✅ 完成（P2-4，Inbox「待分类」+ `ManualClassifyDialog`）；另有 P2-5 单条开关 |
| G5 | 分类体系：`media_asset.category`（电影/剧集/动漫/成人/图集/其他 + 自定义）+ 规则/AI/人工赋值 | ✅ 完成（P3-1，`src/metadata/category.ts`；真实库 25/25 有分类） |
| G6 | 标签治理：低价值过滤（分辨率/类型词/群名/未命名）、大小写归一、每条上限、AI 标签压缩作业 | ✅ 完成（P1 过滤/归一/上限 8；P3-2 补 `tags.consolidate` 只看标签的 AI 归并） |
| G7 | 隐私模式：设置开关 → 敏感分类在媒体库/搜索/首页默认隐藏或遮罩，解锁方式待定 | P3 已备 `is_sensitive`；UI 归 P4-6 |
| G8 | 影音墙 UI：首页横向分类行、分类页海报式网格、桌面向的交互（悬停操作、快捷键、深色主题） | P4；数据入口 `GET /api/library/sections` 已就绪（P3-5） |

## 用户反馈（待补充）

> 把你发现的问题按 `U1、U2…` 编号追加在这里，我会并入计划。

_（已并入上方 F/G 两节，后续新发现继续追加）_

