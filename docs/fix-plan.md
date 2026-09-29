# 修改计划（Fix Plan）— 地基整固

> 依据：`docs/known-issues.md`（A-E）+ 用户 2026-09-29 反馈（U1 AI 分流 / U2 Desktop UI / U3 分类体系 / U4 敏感内容 / U5 标签压缩）
> 范围裁定：**C 类全部暂缓**（MTProto/Agent/Trace/打包/批量/真实 embedding/自动重试/reply 上下文）；本计划只做「地基」：bug + 数据质量 + AI 介入策略 + 分类体系 + UI 重设计 + 运维件。
> **接手请直接读 → `docs/handoff/NEXT-P2-P5-handoff.md`**（环境启动 / 代码地图 / P2-P5 逐项任务书 / 收口流程 / 已知坑）。

## 阶段总览

| 阶段 | 主题 | 覆盖项 | 预期 |
|---|---|---|---|
| **P1** | ✅ 完成（2026-09-29） | A1 A5 A8 B1 B2 B3 B4 B4b E4 | 已提交，见下方清单 |
| **P2** | ✅ 完成（2026-09-29，演示库实机验收；真机待转发确认） | U1 = G1 G2 G3 G4；根治 A3 | 见 `docs/handoff/P2-ai-routing.md` |
| **P3** | ✅ 完成（2026-09-29） | U3 U5 = G5 G6；B5 B8 E2 E3 | 见 `docs/handoff/P3-categories-tags.md`（含实机截图） |
| **P4** | ✅ 主体完成（P4-1~P4-7），**待用户实机微调** | U2 = G8；B7 B10 B11 B12；隐私模式入口 G7 | 见 `docs/handoff/P4-desktop-ui.md` |
| **P5** | 细节与运维收口 | B6 B9 B13 B14；D1 D2 D3 D4 D5 D8 | 1 天 |

执行顺序默认 P1 → P2 → P3 → P4 → P5；每阶段收口提交 + 更新本文件勾选。

---

## P1 — 地基快修 ✅ 完成（2026-09-29）

| # | 任务 | 结果 |
|---|---|---|
| P1-1 | A1 去重键修复 | ✅ 无文件名时 `dedupe_key=nouid:<file_unique_id>`；单测覆盖「同大小不同照片不合并」 |
| P1-2 | B1 详情页文件名 | ✅ 字段表新增「文件名」行（可复制），浏览器实拍确认 |
| P1-3 | B2 照片标题 | ✅ 视觉描述首句 24 字兜底；真机照片类全部有可读标题 |
| P1-4 | B3 垃圾标题 AI 补位 | ✅ `isJunkTitle` + `sanitizeAiTitle`（拒收拒答句/长句）；真机 19/23 标题可读 |
| P1-5 | B4 标签治理 | ✅ 过滤/归一/多来源去重/上限 8：真机 **349 → 170**（均值 7.4，最大 8） |
| P1-6 | E4 来源群名过滤 | ✅ 随 P1-5（动态读取群名） |
| P1-7 | A5 重试刷新 / A6 | ✅ A5 已修；A6 保持现状（语义正确，随 UI 重做再优化） |
| P1-8 | 重跑受影响资产 | ✅ 17 条重富化 + reindex（titlesCleaned=4）；23 条全 done |
| P1-9 | A8 历史坏标题清理（新发现） | ✅ `sanitizeAiTitle` + reindex 清理；真机验证 #8/#10 |
| P1-10 | B4b 推广尾巴清理（新发现） | ✅ `cleanRuleTitle`；真机 4 条清理 |
| — | 回归 | ✅ 单测 63 全绿 + 冒烟 21/21 |

## P2 — AI 介入分流器（用户 U1 方案）✅ 完成（2026-09-29）

> 核心：**不是所有内容都进模型**。按来源配置策略，命中「跳过 AI」的来源 → 直接进人工分类，模型完全不参与。
> 收口证据：`docs/handoff/P2-ai-routing.md`（含实机截图）。

| # | 任务 | 细节 | 结果 |
|---|---|---|---|
| P2-1 | **G1 采集转发来源** | 解析 grammY `forward_origin` 四型 + 兼容旧字段；`telegram_message` 新增 6 列 + 索引（迁移 `0002`） | ✅ 单测 7 例覆盖 4 型 + 旧字段；重复投递回填 |
| P2-2 | **G2 来源策略配置** | settings `ai_skip_sources: string[]`（key 形如 `channel:<id>` / `chat:<id>` / `user:<id>` / `name:<文本>`）；`GET /api/sources/forward`；设置页「来源与 AI 策略」开关面板 | ✅ 演示库 5 个来源可见、可切换 |
| P2-3 | **G3 分流逻辑** | ingest 命中 → **不入队 ai.enrich / embedding.create**，`ai_status='manual'` + `ai_skip=1` + 事件 `media.manual_review` | ✅ 实测 `ai_runs` 0 记录；Inbox 新增「待分类」分组 |
| P2-4 | **G4 人工分类界面** | Inbox「待分类」Tab + `ManualClassifyDialog`（附言 hashtag 预填、历史常用 user 标签 Top10、自由输入、六类 chips、标记敏感）；`POST /api/media/:id/classify` + `GET /api/tags/top` | ✅ 实机走通；分类落库 + audit `media.classified` |
| P2-5 | 单条手动开关 | `POST /api/media/:id/ai-policy {skip}`：跳过 → 撤销未跑作业 + manual；恢复 → 重新入队 ai.enrich。详情页动作条开关 | ✅ 实机三态往返正确（解决「转发自群但来源是人」的灰区） |
| — | 迁移附带 | 因 P2-4 需要落库，`category / category_source / is_sensitive / ai_skip` 一并建在 `0002` | ✅ **P3 不要再加这些列** |

## P3 — 分类体系 + 标签智能 ✅ 完成（2026-09-29）

> 核心：六类 + 自定义，赋值优先级 **user > llm > rule**；标签压缩**只喂标签**（不看内容）。
> 收口证据：`docs/handoff/P3-categories-tags.md`（含实机截图）。**未新增任何列**（列已在迁移 `0002` 建好）。

| # | 任务 | 细节 | 验收 |
|---|---|---|---|
| P3-1 | **G5 分类体系** | `src/metadata/category.ts`：规则（**成人优先→adult** / 季集→series / 图片→gallery / 兜底 other）+ AI prompt 的 `category` 落库（llm）+ 人工优先（user 不可覆盖）；`reindex-search` 增分类回填与 `adult⇒敏感` 不变量修正 | ✅ 真实库 25/25 有分类（终态 adult 12 / gallery 7 / other 5 / anime 1，不调模型）；单测 17 例 |
| P3-2 | **G6 标签压缩作业** | `src/ai/consolidate.ts`：只输入标签 → `{keep,drop,merge,category}` → 应用 + audit；`RUN_KINDS` 新增 `consolidate`；`POST /api/admin/consolidate-tags` 批量；设置页入口 | ✅ 真机 25/25 覆盖、100 作业 0 dead；标签 163→122（均值 4.88）；修掉「模型推理占满 token → 静默无操作」的坑（maxTokens 4096 + 失败记痕 + 队列重试）；单测 6 例 |
| P3-3 | **B5 相册聚簇** | 列表暴露 `mediaGroupId`/`albumCount`；shared 纯函数 `clusterByAlbum` 做稳定相邻聚簇；卡片渲染相册角标 | ✅ 实拍：两张相册图显示「2」角标；单测 5 + 5 例 |
| P3-4 | **B8 排序** | `sort=recent\|updated\|size\|duration\|year`（keyset 仅 recent） | ✅ 实拍：`sort=size` 时 57.1 GB 条排最前 |
| P3-5 | 分类浏览 API | `GET /api/library/sections`（六类 + 自定义 + 未分类，各带计数与预览图）供 P4 影音墙 | ✅ 演示库 series 3 / anime 1 / gallery 2 / other 6 |
| — | 回归 | ✅ 单测 95→**128**（16 文件）+ 冒烟 30→**41/41** + 浏览器实机 9/9 |

## P4 — Desktop UI 重设计（影音墙）🔄 第 1 轮已出，待用户实机审阅

> 目标：从「后台管理风」→「桌面影音客户端」。对标 Jellyfin / Emby / Apple TV 的**浏览与分类逻辑**（不做媒体播放，播放仍回 Telegram）。
> 方式：先出**一版具体实现** → 你在 Tauri 窗口实机审阅 → 多轮微调（不先做纯方案讨论）。
> 进度与截图：`docs/handoff/P4-desktop-ui.md`（**审阅请连真实 core 8787**，演示库没有缩略图）

| # | 任务 | 细节 | 状态 |
|---|---|---|---|
| P4-1 | 视觉基调 | 深色为主的主题体系 + 保留浅色；**霞鹜文楷**（默认，本地字体包）/ Geist 可切；海报式卡片（2:3） | ✅ 第 1 轮 |
| P4-2 | 首页（Home） | Hero 大图（最新一条）+ 「最近归档」横向行 + 各分类夹横向行 | ✅ 第 1 轮 |
| P4-3 | 分类页 | 分类内海报网格 + 筛选 + 排序 | ✅ 第 2 轮：分类 chips + 筛选折叠（含年份/分辨率/标签/AI 状态） |
| P4-4 | 详情页 | 海报式两栏：左大图 + 动作条；右 标题/摘要/标签/来源/注解；确定性字段与任务记录折叠 | ✅ 第 2 轮 |
| P4-5 | 交互逻辑 | 悬停出操作（转发）；右键上下文菜单；快捷键（`/` 搜索、`Esc` 返回）；侧栏收起 + 偏好记忆 | ✅ 第 2 轮（窗口尺寸记忆待 Tauri 插件，转 P5） |
| P4-6 | **G7 隐私模式入口** | 开关（侧栏 + 设置页）；敏感内容在首页/媒体库/搜索默认隐藏，顶部可「临时显示」（仅本次会话） | ✅ 第 2 轮 |
| P4-7 | B7 搜索筛选、B12 应用图标、B10 暗色切换收口 | 随设计一并做 | B10 ✅ / B7 ✅；B12 转 P5（M7 打包前） |

## P5 — 细节与运维收口

| # | 任务 |
|---|---|
| P5-1 | B6 详情页动作：设为主源 / 删除（软删）/ 手动改标题 |
| P5-2 | B9「重新解析（规则）」单条 + 批量 |
| P5-3 | B13 转发增强：多来源选源；相册整组转发（按 group 顺序逐条） |
| P5-4 | B14 Bot 记录「见过的 chat」→ 转发目标下拉 |
| P5-5 | D1 导出脚本跑通 + README 习惯指引；D2 冒烟脚本跑通并纳入流程；D3 缩略图缓存清理入口 |
| P5-6 | D4 日志落盘 + 轮转；D5 lint/format；D8 前端 ErrorBoundary |

---

## 暂缓项（明确不做，等后续阶段）

C1 MTProto（MT Photo 阶段再做）· C2 Agent · C3 Trace 图 · C4 打包 · C5 批量操作 · C6 真实 embedding · C7 自动重试 · C8 reply 上下文

## 待确认（开工前需要拍板）

已拍板（2026-09-29）：
1. ✅ 隐私模式 = **简单开关**（开启后成人分类默认隐藏，设置里一键临时显示）
2. ✅ 分类体系 = **电影 / 剧集 / 动漫 / 成人 / 图集 / 其他 + 自定义**
3. ✅ UI 主题 = **深色优先**（保留浅色可切换）
4. ✅ 验收节奏 = P1-P3 自测汇报；**P4 UI 必须用户实机审阅后迭代**（不做纯方案讨论）
