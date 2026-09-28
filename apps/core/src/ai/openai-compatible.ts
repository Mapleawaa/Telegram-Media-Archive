import fs from 'node:fs';
import type {
  AIProvider,
  ChatPart,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ModelInfo,
  VisionRequest,
} from './types.js';
import { AIProviderError } from './types.js';

export interface OpenAICompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface ApiChatCompletion {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface ApiEmbeddings {
  model?: string;
  data?: { embedding?: number[] }[];
  usage?: { prompt_tokens?: number };
}

const RETRY_DELAYS_MS = [500, 1_500, 4_000];
const DEFAULT_TIMEOUT_MS = 60_000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mimeFromPath(filePath: string): string {
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.id = opts.id;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    body: unknown,
    timeoutMs: number,
    attempt = 0,
  ): Promise<T> {
    const maxRetries = this.opts.maxRetries ?? 3;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < maxRetries) {
          await delay(RETRY_DELAYS_MS[attempt] ?? 4_000);
          return this.request<T>(path, body, timeoutMs, attempt + 1);
        }
        throw new AIProviderError(
          `AI 请求失败 HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`,
          res.status,
          retryable,
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      // 网络异常/超时：指数退避重试
      if (attempt < maxRetries) {
        await delay(RETRY_DELAYS_MS[attempt] ?? 4_000);
        return this.request<T>(path, body, timeoutMs, attempt + 1);
      }
      throw new AIProviderError(`AI 请求异常: ${(err as Error).message}`, undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }

  private toApiContent(content: string | ChatPart[]): unknown {
    if (typeof content === 'string') return content;
    return content.map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      const image = part.image;
      if (image.kind === 'base64') {
        return { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } };
      }
      const buffer = fs.readFileSync(image.path);
      return {
        type: 'image_url',
        image_url: { url: `data:${mimeFromPath(image.path)};base64,${buffer.toString('base64')}` },
      };
    });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => {
        const message: Record<string, unknown> = {
          role: m.role,
          content: this.toApiContent(m.content),
        };
        if (m.toolCalls && m.toolCalls.length > 0) {
          message.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          }));
        }
        if (m.toolCallId) message.tool_call_id = m.toolCallId;
        return message;
      }),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.jsonMode) body.response_format = { type: 'json_object' };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const raw = await this.request<ApiChatCompletion>(
      '/chat/completions',
      body,
      req.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const choice = raw.choices?.[0];
    const finish = choice?.finish_reason;
    return {
      text: choice?.message?.content ?? '',
      toolCalls: (choice?.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      finishReason: finish === 'tool_calls' ? 'tool_calls' : finish === 'length' ? 'length' : 'stop',
      usage: {
        promptTokens: raw.usage?.prompt_tokens ?? 0,
        completionTokens: raw.usage?.completion_tokens ?? 0,
        totalTokens: raw.usage?.total_tokens ?? 0,
      },
      model: raw.model ?? req.model ?? '',
      latencyMs: Date.now() - started,
    };
  }

  vision(req: VisionRequest): Promise<ChatResponse> {
    return this.chat({
      model: req.model,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      jsonMode: req.jsonMode,
      timeoutMs: req.timeoutMs,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: req.prompt }, ...req.images],
        },
      ],
    });
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const body: Record<string, unknown> = { model: req.model, input: req.input };
    if (req.dimensions !== undefined) body.dimensions = req.dimensions;
    const raw = await this.request<ApiEmbeddings>(
      '/embeddings',
      body,
      this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const vectors = (raw.data ?? []).map((d) => d.embedding ?? []);
    return {
      vectors,
      model: raw.model ?? req.model ?? '',
      dimensions: vectors[0]?.length ?? 0,
      usage: { promptTokens: raw.usage?.prompt_tokens ?? 0 },
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/models`, {
      headers: { authorization: `Bearer ${this.opts.apiKey}` },
    });
    if (!res.ok) throw new AIProviderError(`模型列表请求失败 HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => ({
      id: m.id,
      kind: /embed|bge/i.test(m.id) ? 'embedding' : /vl|vision/i.test(m.id) ? 'vision' : 'chat',
    }));
  }
}
