# M3 — AI 富化（Provider 适配器 / 网关 / 富化流水线 / Inbox / AI 活动）

日期：2026-09-28 · 状态：🟡 实现完成并用 mock provider 全链路验证；真实模型待可用 Key

## 1. 目标与结论

给归档链路加"理解层"：AI 只做规则无法可靠处理的事（标题归一化、摘要、语义标签、缩略图理解），全过程经网关记账（ai_runs/ai_steps），失败不影响归档本体。

结论：**代码侧全部完成，32 单测全绿，mock provider 端到端跑通**（11 条媒体自动富化 → Inbox 已完成 11 → AI 活动页 11 次运行可展开步骤）。真实模型暂不可用：硅基流动账户代金券的**模型覆盖窗口（至 2026-06-12）已过期**，实测清单内全部模型 402（余额 61.82 仍在但不可用）。切换路径已铺好：改 `.env` 三个模型名即可，无需改代码。

## 2. 可复现命令与原始输出

```bash
# 模型探测（列出账户可用模型 → docs/handoff/ai-models.md）
$ pnpm -F @tma/core ai:probe
共 98 个模型，已写入 docs/handoff/ai-models.md

# 连通性检测（含代金券清单内代表模型）
$ pnpm -F @tma/core ai:check "deepseek-ai/DeepSeek-V3" "Qwen/Qwen3.5-9B" "Qwen/Qwen3-Embedding-4B" "zai-org/GLM-4.5V"
[chat ] deepseek-ai/DeepSeek-V3 → HTTP 402 {"code":30001,"message":"Sorry, your account balance is insufficient"}
[embed] Qwen/Qwen3-Embedding-4B → HTTP 402（同上，全清单模型一致）

# mock 全链路（演示库，独立目录）
$ AI_PROVIDER=mock AI_CHAT_MODEL=mock/chat AI_VLM_MODEL=mock/vision pnpm -F @tma/core seed:demo
  media_asset=11（新建 11）telegram_message=13   # jobs: ai.enrich pending ×11
$ TMA_DATA_DIR=.data-demo CORE_PORT=8788 AI_PROVIDER=mock ... pnpm exec tsx src/index.ts
$ curl :8788/api/inbox        → pending 0 / partial 0 / failed 0 / done 11
$ curl :8788/api/ai/runs/1    → steps: enrich.text(0ms), output={"title":"Breaking.Bad...","summary":"[mock]..."}
$ curl ":8788/api/media?limit=3" → 每条 tags: ["mock标签","测试"]（source=llm）

# 单测（含富化 4 例：未启用跳过 / 文本+视觉 / 仅文本 / 故障降级）
$ pnpm -F @tma/core test   # Test Files 5 passed | Tests 32 passed

# 密钥零泄漏（只输出计数）
archive.db 命中 0 · .data 下文件命中 0 · core 运行日志命中 0

# 真实库（AI 未启用）行为
$ POST :8787/api/media/1/enrich
{"error":"ai_disabled","message":"AI 未启用：请在 .env 配置 AI_BASE_URL/AI_API_KEY/AI_CHAT_MODEL（或设 AI_PROVIDER=mock 演示）"}
```

浏览器实拍：Inbox 四页签（已完成 11）；AI 活动页 11 次运行列表 + Run #11 详情（provider/model/耗时 + step 01 `model_call enrich.text` 的 input/output JSON 可读）。

## 3. 验收清单（对照 roadmap M3）

- [x] AIProvider 接口 + OpenAICompatibleProvider（重试/超时/视觉 base64）+ MockProvider + per-capability 模型配置
- [x] 网关：ai_runs/ai_steps 记账（含 latency/token 累计）、错误入库、脱敏（registerSecret 覆盖 AI_API_KEY）
- [x] `ai.enrich` 作业：归档自动入队（dedupe_key 防重复）→ worker 消费 → 摘要/标签/标题落库 → 搜索文档重建 → `media.analyzed` 事件
- [x] ai_status 状态机：pending → done/partial/failed/skipped；AI 未启用时归档直接 skipped
- [x] Inbox 页（待分析/部分完成/失败/已完成 + 一键分析/重试）；AI 活动页（运行列表 + 步骤时间线 + JSON 展开）
- [x] 失败不影响归档：provider 故障 → run=failed + ai_status=failed + 队列重试（单测覆盖）
- [x] 密钥不入库不入日志（grep 计数 0）
- [~] 真实模型跑通 10 条媒体：**阻塞在账户侧**（代金券模型覆盖过期，全部 402）；mock 已完整验证同一代码路径

## 4. 已知问题与偏离

| 项 | 说明 |
|---|---|
| 硅基流动代金券 | 覆盖模型清单有效期至 2026-06-12，当前全部 402；解法：充值（Qwen3-8B 级约 ¥0.5/M token）或换智谱 GLM-4-Flash（免费）/通义 |
| 视觉步骤验证程度 | 视觉路径由单测（假 client 写伪 JPEG）覆盖；演示库无真实缩略图文件，端到端视觉调用待真实 Key |
| 规则标题优先 | AI 标题只在无规则标题时写入 canonical_title（确定性优先原则）；AI 摘要与标签始终追加 |
| token 累计 | 早期 11 次 run 的 totalTokens 为 null（修复前记录），后续 run 正常累计 |
| 偏差记录 | 计划中 `ai.enrich` 的标题策略由"AI 覆盖"改为"规则优先、AI 补位"（符合架构稿 §38 确定性优先） |

## 5. 下一里程碑入口

- **M4（向量 RAG）**：需要可用 Embedding 模型（`AI_EMBED_MODEL`）——同样阻塞在账户侧；sqlite-vec 已在依赖中，`media_embedding` 表与 `embedding.create` 作业可先行用 mock 向量实现
- **M2（MTProto）**：与 AI 账户解耦，随时可开工（需要用户小号 session）
- 用户拿到可用 Key 后：改 `.env`（AI_BASE_URL/AI_API_KEY/AI_CHAT_MODEL，可选 VLM/EMBED）→ 重启 core → 对现存 4 条真实媒体在 Inbox 一键分析
