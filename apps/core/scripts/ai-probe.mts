/**
 * AI 模型探测：列出服务商 /v1/models 实际可用模型并按能力分类。
 * 用法：pnpm -F @tma/core ai:probe
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
if (!config.AI_BASE_URL || !config.AI_API_KEY) {
  console.error('缺少 AI_BASE_URL / AI_API_KEY，请先在 apps/core/.env 配置');
  process.exit(1);
}

interface ModelInfo {
  id: string;
  [key: string]: unknown;
}

const res = await fetch(`${config.AI_BASE_URL}/models`, {
  headers: { authorization: `Bearer ${config.AI_API_KEY}` },
});

if (!res.ok) {
  console.error(`模型列表请求失败: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}

const body = (await res.json()) as { data?: ModelInfo[] };
const models = body.data ?? [];
const ids = models.map((m) => m.id).sort();

const CATEGORIES: Array<{ key: string; label: string; test: (id: string) => boolean }> = [
  { key: 'embedding', label: 'Embedding（RAG 用）', test: (id) => /embed|bge|gte/i.test(id) },
  { key: 'rerank', label: 'Reranker', test: (id) => /rerank/i.test(id) },
  {
    key: 'vision',
    label: 'Vision（缩略图理解）',
    test: (id) => /vl|vision|glm-4v|internvl|minicpm-v/i.test(id),
  },
  { key: 'chat', label: 'Chat / LLM（富化、Agent）', test: () => true },
];

const used = new Set<string>();
const lines: string[] = [`# AI 可用模型（${config.AI_BASE_URL}）`, '', `探测时间：${new Date().toISOString()}`, ''];

for (const cat of CATEGORIES) {
  const matched = ids.filter((id) => !used.has(id) && cat.test(id));
  matched.forEach((id) => used.add(id));
  lines.push(`## ${cat.label}（${matched.length}）`, '');
  lines.push(matched.length > 0 ? matched.map((id) => `- \`${id}\``).join('\n') : '_无_');
  lines.push('');
}

const outPath = path.join(import.meta.dirname, '..', '..', '..', 'docs', 'handoff', 'ai-models.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

console.log(`共 ${ids.length} 个模型，已写入 docs/handoff/ai-models.md\n`);
for (const cat of CATEGORIES) {
  const matched = ids.filter((id) => cat.test(id)).slice(0, 12);
  console.log(`${cat.label}: ${matched.join(', ') || '(无)'}`);
}
