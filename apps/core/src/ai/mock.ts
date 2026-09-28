import { createHash } from 'node:crypto';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ModelInfo,
  VisionRequest,
} from './types.js';

const MOCK_DIM = 64;

function hashVector(text: string, dim = MOCK_DIM): number[] {
  const digest = createHash('sha256').update(text).digest();
  const vec: number[] = [];
  for (let i = 0; i < dim; i += 1) {
    vec.push((digest[i % digest.length]! / 255) * 2 - 1);
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function lastUserText(req: ChatRequest | VisionRequest): string {
  const messages = 'messages' in req ? req.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      if (text) return text;
    }
  }
  return 'prompt' in req ? req.prompt : '';
}

function mockEnrichmentReply(prompt: string): string {
  const filename = /文件名[:：]\s*(.+)/.exec(prompt)?.[1]?.trim() ?? '';
  const base = filename.replace(/\.[A-Za-z0-9]{2,4}$/, '') || '未命名媒体';
  return JSON.stringify({
    title: base.slice(0, 80),
    summary: `[mock] 基于文件名与附言生成的占位摘要：${base.slice(0, 60)}`,
    tags: ['mock标签', '测试'],
    category: 'video',
  });
}

function mockVisionReply(): string {
  return JSON.stringify({
    description: '[mock] 缩略图视觉描述占位',
    themes: ['mock主题'],
    mood: ['mock氛围'],
  });
}

export class MockProvider implements AIProvider {
  readonly id = 'mock';

  chat(req: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const prompt = lastUserText(req);
    const isVisionPrompt = prompt.includes('缩略图');
    const text = isVisionPrompt ? mockVisionReply() : mockEnrichmentReply(prompt);
    return Promise.resolve({
      text,
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(text.length / 4),
        totalTokens: Math.ceil((prompt.length + text.length) / 4),
      },
      model: req.model ?? 'mock/chat',
      latencyMs: Date.now() - started,
    });
  }

  vision(req: VisionRequest): Promise<ChatResponse> {
    const started = Date.now();
    const text = mockVisionReply();
    return Promise.resolve({
      text,
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        promptTokens: Math.ceil(req.prompt.length / 4),
        completionTokens: Math.ceil(text.length / 4),
        totalTokens: 0,
      },
      model: req.model ?? 'mock/vision',
      latencyMs: Date.now() - started,
    });
  }

  embed(req: EmbedRequest): Promise<EmbedResponse> {
    return Promise.resolve({
      vectors: req.input.map((text) => hashVector(text, req.dimensions ?? MOCK_DIM)),
      model: req.model ?? 'mock/embed',
      dimensions: req.dimensions ?? MOCK_DIM,
      usage: { promptTokens: req.input.length * 8 },
    });
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([
      { id: 'mock/chat', kind: 'chat' },
      { id: 'mock/vision', kind: 'vision' },
      { id: 'mock/embed', kind: 'embedding' },
    ]);
  }
}
