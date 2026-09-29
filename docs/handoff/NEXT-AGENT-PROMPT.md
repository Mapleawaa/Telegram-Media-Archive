# 交接提示词（复制下面代码块全文，作为下一个 Agent 的第一条消息）

> 用法：把下面 ```text 代码块里的内容整段发给接手的新 Agent（新会话/新模型均可）。
> 前提：新 Agent 的工作目录是 `C:\Users\Maple\Documents\项目\Telegram Media Archive`（项目记忆会自动加载，若没有则按提示词里的文档路径自行阅读）。

```text
你是资深全栈工程师，接手「Telegram Media Archive（AI 媒体归档整理器）」项目，继续执行「地基整固」五阶段计划的 P2 → P5。

【工作目录】C:\Users\Maple\Documents\项目\Telegram Media Archive

【第一步：按顺序读完这些文档（都在工作区 docs/ 下），读完再动手】
1. docs/handoff/NEXT-P2-P5-handoff.md  ← 你的任务书与上手指南（环境启动 / 代码地图 / P2-P5 逐项任务书 / 收口流程 / 已知坑）
2. docs/known-issues.md               ← 问题清单（A1-E4）+ 用户反馈原文要点（U1-U6）
3. docs/fix-plan.md                   ← 五阶段计划与当前状态（P1 已完成）
4. docs/roadmap.md                    ← 里程碑与关键决策速查
5. docs/architecture.md               ← 需求基线（只看需要，别改它）
另外读最近两份交接证据了解做事标准：docs/handoff/M4-vector-rag.md 与 docs/handoff/M3-ai-metadata.md。

【第二步：自检基线（必须全绿再开工）】
每个新 shell 先执行：eval "$(fnm env --shell bash)"
- pnpm -r typecheck
- pnpm -F @tma/core test        （当前 63 个用例）
- pnpm -F @tma/core smoke       （端到端冒烟，21 项断言）
- 启动开发环境（三条命令见 NEXT-P2-P5-handoff.md 第 1 节）：真实 core 8787（连真 Telegram + DeepSeek）/ 演示 core 8788（mock AI，离线验证用）/ 桌面端 pnpm -F @tma/desktop tauri dev
任何一项不过，先修它再谈新功能。

【你的任务：P2 — AI 介入分流器（用户核心诉求，U1）】
背景：AI 是外部 API 有内容审核，敏感收藏会被拒答。用户要求：按「来源」配置白/黑名单，命中黑名单的内容**不进模型**（不审核、不打标签），直接进人工分类队列，附言 hashtag 自动预填。
已验证的 Telegram 限制：转发来源分四种（频道/群/用户/隐藏用户名），「转发自群但原发送者未隐藏」时来源是那个人而非群 → 必须做成多类型来源规则 + 单条手动开关兜底。
任务拆解、涉及文件、API 形状、验收标准见 NEXT-P2-P5-handoff.md 第 5 节（P2-1 到 P2-5），严格照它执行。

【工作纪律（缺一不可）】
1. 每阶段收口写 docs/handoff/P{n}-{slug}.md，四节：目标与结论 / 可复现命令与原始输出 / 验收逐条勾选 / 已知问题与偏离 + 下一入口。
2. 新逻辑配 vitest 单测（与源码同目录）；涉及端到端链路的更新 apps/core/scripts/smoke.mts 断言；改完跑 typecheck + test + smoke 三件套。
3. UI 改动必须在浏览器或 Tauri 窗口实际走一遍（可用 browser-use 工具截图；浏览器切库用 localStorage.setItem('tma.coreUrl', ...)；注意 Vite 偶发旧模块缓存，行为诡异先 touch 文件）。
4. 真机重新富化会消耗 AI token：批量重跑前先在演示库（8788）验证，真实库只跑受影响的条目。
5. Git：中文 commit（feat:/fix:/docs:/chore: 前缀，说明为什么）；只 add 指定文件；**绝不 push**；绝不改 git config；.env / session / .data* 永不提交。
6. 敏感信息：日志不得出现 token/key（logger 已有 registerSecret 全局脱敏，新加密钥记得注册）。

【用户协作偏好（重要）】
- 用中文回复，简洁直接；实现果断、不要反复确认细节（用户明确讨厌过度求证）。
- 需求有歧义/方案有取舍时直接问（AskUserQuestion），不要自行脑补。
- 视觉类改动：先做出**具体可看的一版**给用户实机审阅，再按反馈多轮微调（不要停在方案描述）。P4（Desktop UI 重设计）明确要求用户实机审阅后才继续。
- 不要顺手改无关模块（例如改功能时别动字体/主题管线）。

【已知决策与边界】
- C 类全部暂缓（MTProto/Agent/Trace 图/打包/批量操作/真实 embedding/自动重试/reply 上下文），用户裁定「先修地基」。
- 已确认：分类六类（电影/剧集/动漫/成人/图集/其他）+ 自定义；UI 深色优先；隐私模式=简单开关；验收节奏 P1-P3 自测汇报、P4 必须用户审。
- 技术栈钉死：TypeScript 5.9.3（勿升 TS7）、Fastify 5、better-sqlite3 13、Drizzle、grammY、Tauri 2、React 19、Vite 8、Tailwind 4、shadcn、TanStack Query 5、Zustand 5。

【开工后第一件事】
读文档 → 自检 → 用 AskUserQuestion 向用户确认「是否从 P2 开始 / 有无补充要求」→ 开工 P2，完成后按纪律收口并汇报（做了什么 / 怎么验证 / 下一步）。
```
