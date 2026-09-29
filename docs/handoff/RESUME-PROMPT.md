# 恢复提示词（上下文丢失/压缩后重新开工用）

> ⚠️ **本文的现场快照是「P2 已收口、P3 待开工」那一刻的存档，现已过时**。
> 当前状态：**P1 ✅ / P2 ✅ / P3 ✅ / P4 待开工**（P3 收口见 `docs/handoff/P3-categories-tags.md`）。
> 若现在要恢复上下文，请改按 `CLAUDE.md` 的「状态速览 + 下一步」与 `NEXT-P2-P5-handoff.md` §7 描述现状。

> 用法：把下面 ```text 代码块整段发给接手 Agent（当它上下文被压缩、状态混乱或需要重启时）。
> 现场快照由维护者于 2026-09-29 17:0x 从 git / 数据库 / 服务状态核实，可作权威事实使用。

```text
你之前的工作上下文可能已丢失或被压缩——这不影响你的能力判断。以下是**权威现场快照**（已从 git / 数据库 / 服务状态逐项核实），一切以此为准，不要凭记忆猜测。

【你是谁 / 在做什么】
你是「Telegram Media Archive（AI 媒体归档整理器）」项目的接手工程师，正在执行 docs/fix-plan.md 的 P2 → P5 阶段计划。
工作目录：C:\Users\Maple\Documents\项目\Telegram Media Archive

【权威现场快照】
- git 最新提交（从新到旧）：b52bed3（fix P2：图片体检两处中文缺陷）→ 09ed1ae（CLAUDE.md 补 UI 实机核验方法）→ 1c907eb（P2 收口文档）→ fd51279（feat P2：AI 介入分流器主体）
- 未提交（工作区）：① apps/core/scripts/purge-ai.mts（新脚本，**已实际执行成功**：#24/#25 已清退）② apps/core/package.json（新增 purge:ai 命令）③ .workbuddy/（你的工作目录，未被 gitignore）
- 真实库（apps/core/.data/archive.db，共 25 条）：#24/#25 已是 ai_status='manual' + ai_skip=1，AI 摘要/标签/标题已清空、只剩 rule 标签；settings.ai_skip_sources = ["channel:-1001666424170"]（用户已拉黑该来源）
- 服务在跑：8787 真实 core / 8788 演示 core / 5173 Vite
- purge-ai **在 docs/ 里没有任何记录**（我搜过），这是你欠的文档
- apps/core/.data-demo.bak-1790670545 与 .data-demo.bak-1790670905 是你重建演示库时的备份（已被 .gitignore 的 .data*/ 覆盖）

【第一步：恢复上下文（只读，先别改代码）】
按顺序读：
1. .workbuddy/memory/2026-09-29.md —— 你自己之前的工作笔记（关键决定与坑都在里面，读它最快恢复状态）
2. docs/handoff/P2-ai-routing.md —— 你写的 P2 收口（含实机截图、图片体检结论、§5.3 缺口清单）
3. docs/handoff/NEXT-P2-P5-handoff.md §6 —— P3 任务书（你的下一步）
4. docs/known-issues.md 与 docs/fix-plan.md —— 问题清单与阶段状态
5. CLAUDE.md —— 铁律、坑位、UI 实机核验方法（你自己补的那条 recipe）

【第二步：收拾当前工作区（先收口，再开新活）】
1. 跑基线三件套确认现场是绿的（红则先修）：
   eval "$(fnm env --shell bash)"
   pnpm -r typecheck && pnpm -F @tma/core test && pnpm -F @tma/core smoke
2. 给 purge-ai 补收口：
   - 文档：docs/handoff/P2-ai-routing.md 增一节说明 `purge:ai`（场景=「拉黑之前已富化的存量内容」、删除什么/保留什么（ai_runs 审计不可抹）、实测 #24/#25 的结果）；在 CLAUDE.md 常用命令里补 `pnpm -F @tma/core purge:ai <mediaId...>`
   - 提交：apps/core/scripts/purge-ai.mts + apps/core/package.json + 文档，一个 fix(P2) 或 docs(P2) commit，message 写清「为什么需要它」
3. 把 .workbuddy/ 加进 .gitignore（agent 工作目录不该入库）并单独提交
4. （可选）两个 .data-demo.bak-* 是否删除先问用户——已被忽略，留着也不影响仓库

【第三步：继续 P3（分类体系 + 标签智能）】
严格按 docs/handoff/NEXT-P2-P5-handoff.md §6 执行。注意：**你在迁移 0002 里已经把 P3 需要的列建好了**（media_asset.category / category_source / is_sensitive / ai_skip）——P3-1 不要再加列，只需：写规则映射 + 把 AI 富化 prompt 里的 category 字段接上落库 + 人工优先覆盖。

你笔记里的关键约束（务必遵守）：
- 标签过滤表**不要**包含 电影/剧集/动漫/图集/成人（它们是 P3 的分类取值）
- classify 的用户标签不做低价值过滤（只归一化 + 去重）
- 状态语义：ai_skip=1 ⇔ 当前被排除在 AI 之外；applyEnrichment 在 done/partial 时清它
- tags.consolidate 作业：user 标签不可被 drop/merge

【纪律（不变）】
- 每阶段收口写 docs/handoff/P{n}-*.md 四节：目标与结论 / 可复现命令与原始输出 / 验收逐条勾选 / 已知问题与偏离 + 下一入口
- 改完必跑 typecheck + test + smoke；端到端链路改动同步更新 apps/core/scripts/smoke.mts 断言
- UI 改动必须实机核验（用你已配置好的 playwright-core + 系统 Chrome 方案）
- AI 成本：批量重新富化前先在演示库（8788）验证，真实库只跑受影响条目
- git：中文 commit（feat:/fix:/docs:/chore:，写清为什么）、只 add 指定文件、**绝不 push**、**绝不改 git config**
- 密钥：.env / .data* / session 永不提交；日志不得含 token/key
- 完成后向用户汇报：做了什么 / 怎么验证 / 下一步

【现在开始】按「第一步读 → 第二步收口 → 第三步 P3」的顺序执行；先读文件，不要急着改代码。若读到的现场与本快照不一致，以实际读到的为准，并在汇报里指出差异。
```
