# M4 — Vector RAG（sqlite-vec / embedding 流水线 / Hybrid 检索）

日期：2026-09-29 · 状态：✅ 代码完成（mock 全链路验证）；真实 embedding 待接入（入口已就绪）

## 1. 目标与结论

给检索加语义路：结构化 + FTS + 向量三路召回 → RRF 融合 → 结果（rerank 留待接入 rerank 模型）。

按用户要求做成**多模型适配**：chat / vision / embed 三个能力**各自独立配置** baseUrl / apiKey / model（缺省回退共享 `AI_BASE_URL` / `AI_API_KEY`）——典型场景如"文本用 DeepSeek、向量用本地 Ollama bge-m3"，无需改动代码。未配置的能力自动降级：无 embed → 语义检索关闭（debug 可见），无 vec 扩展 → 整个向量层跳过。

**真实 embedding 仍未接入**：DeepSeek 无 embedding 能力；硅基流动代金券模型覆盖已过期。可用入口（任选）：
- 本地 Ollama：装 Ollama → `ollama pull bge-m3` → `.env` 设 `AI_EMBED_BASE_URL=http://127.0.0.1:11434/v1`、`AI_EMBED_MODEL=bge-m3`、`AI_EMBED_API_KEY=ollama`（免费离线）
- 硅基流动充值后用 `BAAI/bge-m3`；或智谱 `embedding-3`
配置后：设置页「重建向量索引」→ 自动为全部媒体生成向量。

## 2. 可复现命令与原始输出

```bash
# 单测（新增 9 例：KNN 往返 / 维度变化重建 / 缓存不重复计费 / 内容变化重算 /
#        归档链式入队 / 三路融合 / 降级 / 结构化过滤 / 空表守卫）
$ pnpm -F @tma/core test   # Test Files 7 passed | Tests 41 passed

# mock 全链路（演示库）
$ AI_PROVIDER=mock AI_CHAT_MODEL=mock/chat AI_VLM_MODEL=mock/vision AI_EMBED_MODEL=mock/embed pnpm -F @tma/core seed:demo
$ TMA_DATA_DIR=.data-demo CORE_PORT=8788 AI_PROVIDER=mock ... pnpm exec tsx src/index.ts
$ curl :8788/api/ai/capabilities
{"providerKind":"mock","chat":{"enabled":true,"model":"mock/chat",...},"vision":{...},"embed":{...},
 "vector":{"available":true,"dim":64,"embeddedCount":11}}
$ curl :8788/api/ai/runs     → 按类型计数：{"enrich":11,"embedding":11}   # 富化后自动接力向量化

# Hybrid 检索（关键词查询：FTS 领跑，向量补充）
POST /api/search {"query":"绝命毒师"} → strategy=hybrid, fts=2, vector=11, 3ms
   结果：3:绝命毒师 第五季 / 1:Breaking Bad / 6:学习资料合集 / 10:Interstellar / 7:podcast ep 42
# Hybrid 检索（无关键词命中：纯向量召回）
POST /api/search {"query":"赛博朋克 未来城市"} → strategy=hybrid, fts=0, vector=11, 返回 5

# 浏览器实拍：搜索页徽标「Hybrid · FTS + 向量（RRF 融合）」+ 各路命中数与耗时；
# 设置页「AI 能力」面板：三能力模型/服务商、向量库 64 维·已向量化 11 条、重建向量索引按钮
```

## 3. 验收清单（对照 roadmap M4）

- [x] sqlite-vec 接入（加载失败自动降级）；vec_media 按维度动态建表，维度变化自动重建 + 清旧记录重算
- [x] embedding.create 作业：文档组装（标题/摘要/标签/附言/文件名/属性）、content_hash 缓存（不重复计费）、维度记录到 settings
- [x] 链式入队：归档 → ai.enrich → embedding.create；富化未启用但向量可用时直接入队 embedding
- [x] Hybrid 检索：structured + FTS + vector → RRF 融合；debug 暴露 ftss/vector 命中与策略；无 embed 时降级为 FTS/LIKE
- [x] 多模型适配入口：per-capability baseUrl/apiKey/model + 能力状态端点 /api/ai/capabilities
- [x] 「重建向量索引」端点（批量入队去重）+ 设置页按钮
- [x] 41 单测全绿（含 9 个 M4 用例）
- [~] 真实语义检索质量：待接入真实 embedding 模型（DeepSeek 无此能力；mock 向量为哈希，仅验证管线与排序融合）

## 4. 已知问题与偏离

| 项 | 说明 |
|---|---|
| sqlite-vec 主键绑定 | vec0 主键不接受普通参数绑定（实测 0.1.9 报 "Only integers are allows..."）→ 插入用 `CAST(? AS INTEGER)`；DELETE/SELECT 正常 |
| rerank 阶段 | 计划中的 LLM rerank 未做（DeepSeek 无 rerank 模型；可用 chat 模型做候选重排，留待 M5 Agent 一并实现） |
| 向量是派生数据 | 维度变化/换模型时直接重建（符合架构稿 §4.1 可重建原则）；已在 ensureVecTable 内自动清 media_embedding 记录 |
| confidence 字段 | media_tag 的 confidence 暂未写入（LLM/视觉标签统一 null），留待 M5 |
| 搜索 debug | `vectorHits` 是候选数（KNN top-K），非最终结果数 |

## 5. 下一里程碑入口

- **M2（MTProto）**：与 AI 账户解耦，需要用户小号 session
- **M5（Agent）**：工具白名单 + intent + trace；可顺带实现 chat 模型 rerank（复用 gateway.runChat）
- 用户接入真实 embedding 后：设置页点「重建向量索引」，再用「找那个压抑的赛博朋克片」这类查询验收语义召回
