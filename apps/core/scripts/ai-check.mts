/**
 * AI 连通性检查：测试指定模型是否可调用（默认测 .env 中配置的三个模型）。
 * 用法：pnpm -F @tma/core ai:check [model1 model2 ...]
 */
import { loadConfig } from '../src/config.js';

const config = loadConfig();
if (!config.AI_BASE_URL || !config.AI_API_KEY) {
  console.error('缺少 AI_BASE_URL / AI_API_KEY');
  process.exit(1);
}

const candidates =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : [config.AI_CHAT_MODEL, config.AI_VLM_MODEL, config.AI_EMBED_MODEL].filter(
        (m): m is string => Boolean(m),
      );

if (candidates.length === 0) {
  console.error('未提供模型名，且 .env 中 AI_CHAT_MODEL/AI_VLM_MODEL/AI_EMBED_MODEL 均为空');
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${config.AI_API_KEY}`,
  'content-type': 'application/json',
};

async function testChat(model: string): Promise<string> {
  const res = await fetch(`${config.AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '只回复两个字：可以' }],
      max_tokens: 16,
    }),
  });
  const text = await res.text();
  if (!res.ok) return `HTTP ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 160)}`;
  const body = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  return `OK → ${body.choices?.[0]?.message?.content?.trim() ?? '(空)'}`;
}

async function testEmbedding(model: string): Promise<string> {
  const res = await fetch(`${config.AI_BASE_URL}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: ['测试文本'] }),
  });
  const text = await res.text();
  if (!res.ok) return `HTTP ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 160)}`;
  const body = JSON.parse(text) as { data?: { embedding?: number[] }[] };
  const dim = body.data?.[0]?.embedding?.length;
  return `OK → ${dim} 维`;
}

for (const model of candidates) {
  const isEmbedding = /embed|bge/i.test(model) && !/rerank/i.test(model);
  const result = isEmbedding ? await testEmbedding(model) : await testChat(model);
  console.log(`${isEmbedding ? '[embed]' : '[chat ]'} ${model} → ${result}`);
}
