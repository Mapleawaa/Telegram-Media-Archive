# M3 — AI 富化（Provider 适配器 / 网关 / 富化流水线 / Inbox / AI 活动）

日期：2026-09-28 起 · 状态：✅ 达成（真实模型 DeepSeek 全链路验证完成）

## 1. 目标与结论

给归档链路加"理解层"：AI 只做规则无法可靠处理的事（标题归一化、摘要、语义标签、缩略图理解），全过程经网关记账（ai_runs/ai_steps），失败不影响归档本体。

结论：**全部完成**。真实模型接入 DeepSeek（2026-09-29 凌晨切换成功）：`deepseek-flash`（文本，摘要/标签质量良好）+ `deepseek-v4-flash-vision-exp`（视觉，画面描述 + 主题/氛围标签）已把 4 条真实媒体全部富化到 `done`（extractedBy=mixed）。

途中解决两个真实问题：
1. 硅基流动代金券模型覆盖过期（全 402）→ 切换 DeepSeek（OpenAI 兼容，国内直连）。
2. DeepSeek 视觉模型是**推理型**：600 max_tokens 时正文被推理占满返回空白；修复为 ① max_tokens 提到 2048 ② 读取 `reasoning_content` 兜底 ③ 推理内容记入 ai_steps 便于诊断。

## 2. 可复现命令与原始输出

```bash
# 模型探测（DeepSeek）
$ pnpm -F @tma/core ai:probe
共 2 个模型 → Chat: deepseek-flash, deepseek-v4-pro

# 真实富化（4 条真实媒体，经 Inbox「分析」按钮或 API）
POST /api/media/{1..4}/enrich → 全部 ok
$ curl :8787/api/inbox
pending 0 / partial 0 / failed 0 / done 4

$ curl :8787/api/media/1
ai: done | extractedBy: mixed
summary: 一条与《异环》及“小吱”相关的 2K 视频，由 Redgectx 发布或转发，时长 5 分 53 秒。
         两名动漫角色在室内近距离互动的画面，其中一人从后方环抱另一人，整体呈现成人向二次元风格。
tags: 2K/CHIZ/Redgectx/二次元/亲密互动/小吱/异环/成人向/暧昧/游戏/私密/紧张/视频/角色扮演

# run #6 步骤（文本 + 视觉各一步，token 累计 1257）
step 0 enrich.text   succeeded 2376ms  → {"title":"Redgectx CHIZ 2K","summary":...,"tags":[...]}
step 1 enrich.vision succeeded 1431ms  → {"description":"两名动漫角色在室内近距离互动的画面...","themes":[...],"mood":[...]}

# mock 全链路（离线演示，独立目录 .data-demo，8788 端口）
$ AI_PROVIDER=mock AI_CHAT_MODEL=mock/chat AI_VLM_MODEL=mock/vision pnpm -F @tma/core seed:demo
  media_asset=11 telegram_message=13   # ai.enrich pending ×11 → core 启动后全部 done

# 单测（含富化 4 例：未启用跳过 / 文本+视觉 / 仅文本 / 故障降级）
$ pnpm -F @tma/core test   # Test Files 5 passed | Tests 32 passed

# 密钥零泄漏（只输出计数）
archive.db 命中 0 · .data 下文件命中 0 · core 运行日志命中 0

# 真实库 AI 未配置时的行为
POST /api/media/1/enrich → 400 {"error":"ai_disabled","message":"AI 未启用：请在 .env 配置..."}
```

浏览器实拍：Inbox 四页签；AI 活动页运行列表 + Run 详情（provider/model/耗时/token + 每步 input/output JSON 含 reasoning 摘要）。

## 3. 验收清单（对照 roadmap M3）

- [x] AIProvider 接口 + OpenAICompatibleProvider（重试/超时/视觉 base64/reasoning_content 兜底）+ MockProvider + per-capability 模型配置
- [x] 网关：ai_runs/ai_steps 记账（含 latency/token 累计/推理摘要）、错误入库、脱敏（registerSecret 覆盖 API Key）
- [x] `ai.enrich` 作业：归档自动入队（dedupe_key 防重复）→ worker 消费 → 摘要/标签/标题落库 → 搜索文档重建 → `media.analyzed` 事件
- [x] ai_status 状态机：pending → done/partial/failed/skipped；AI 未启用时归档直接 skipped
- [x] Inbox 页（待分析/部分完成/失败/已完成 + 一键分析/重试）；AI 活动页（运行列表 + 步骤时间线 + JSON 展开）
- [x] 失败不影响归档：provider 故障 → run=failed + ai_status=failed + 队列重试（单测覆盖）
- [x] 密钥不入库不入日志（grep 计数 0）
- [x] **真实模型跑通 4 条真实媒体**：DeepSeek 文本 + 视觉全部 done，extractedBy=mixed，token 记账正常

## 4. 已知问题与偏离

| 项 | 说明 |
|---|---|
| 硅基流动代金券 | 模型覆盖清单有效期至 2026-06-12，现已过期（全 402）→ 已切换 DeepSeek，硅基流动配置保留在文档备查 |
| DeepSeek 视觉是推理型 | 正文可能被推理占满返回空白：max_tokens=2048 + reasoning_content 兜底 + 推理内容记入 ai_steps；若仍偶发空白，优先看 step.output.reasoning |
| DeepSeek 无 embedding/rerank | M4 向量检索需要另配 embedding（硅基流动/智谱/本地 bge-m3），或用 mock 向量先行 |
| 规则标题优先 | AI 标题只在无规则标题时写入 canonical_title（确定性优先原则）；AI 摘要与标签始终追加 |
| 标签冗余 | 同一标签可能来自多个来源（rule/llm/vision 各一条，唯一键含 source），UI 目前合并展示；去重展示留到 UI 打磨 |
| 偏差记录 | 计划中 `ai.enrich` 的标题策略由"AI 覆盖"改为"规则优先、AI 补位"（符合架构稿 §38 确定性优先） |

## 5. 下一里程碑入口

- **M4（向量 RAG）**：sqlite-vec 已在依赖中；需 embedding 模型（DeepSeek 无此能力 → 硅基流动 bge-m3/智谱 embedding-3/本地 Ollama bge-m3 三选一），`media_embedding` 表与 `embedding.create` 作业可先用 mock 向量搭好
- **M2（MTProto）**：与 AI 账户解耦，需要用户小号 session
- 真实库现状：4 条真实媒体已富化完成；新归档会自动入队 ai.enrich（`.env` 已配 DeepSeek）
