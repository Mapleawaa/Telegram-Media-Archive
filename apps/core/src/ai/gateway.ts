import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import type { Db } from '../database/client.js';
import { aiRuns, aiSteps, type RUN_KINDS, type STEP_TYPES } from '../database/schema.js';
import { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  VisionRequest,
} from './types.js';

export type AiProviderKind = 'none' | 'mock' | 'openai';
export type RunKind = (typeof RUN_KINDS)[number];
export type StepType = (typeof STEP_TYPES)[number];

export interface StepInput {
  type: StepType;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  status: 'running' | 'succeeded' | 'failed';
  latencyMs?: number;
  tokenUsage?: unknown;
  error?: string;
}

export interface CapabilityState {
  chat: boolean;
  vision: boolean;
  embed: boolean;
}

function resolveProviderKind(config: AppConfig): AiProviderKind {
  if (config.AI_PROVIDER === 'mock' || config.AI_PROVIDER === 'none' || config.AI_PROVIDER === 'openai') {
    return config.AI_PROVIDER;
  }
  // auto：具备 baseUrl + key + chatModel 时用真实 provider，否则视为未启用
  if (config.AI_BASE_URL && config.AI_API_KEY && config.AI_CHAT_MODEL) return 'openai';
  return 'none';
}

export class AiGateway {
  readonly providerKind: AiProviderKind;
  readonly provider: AIProvider | null;
  readonly chatModel?: string;
  readonly visionModel?: string;
  readonly embedModel?: string;
  private readonly stepCounters = new Map<number, number>();
  private readonly runTokens = new Map<number, number>();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    config: AppConfig,
  ) {
    this.providerKind = resolveProviderKind(config);
    this.chatModel = config.AI_CHAT_MODEL;
    this.visionModel = config.AI_VLM_MODEL;
    this.embedModel = config.AI_EMBED_MODEL;

    if (this.providerKind === 'openai') {
      this.provider = new OpenAICompatibleProvider({
        id: 'openai',
        baseUrl: config.AI_BASE_URL!,
        apiKey: config.AI_API_KEY!,
      });
    } else if (this.providerKind === 'mock') {
      this.provider = new MockProvider();
    } else {
      this.provider = null;
    }

    logger.info(
      {
        provider: this.providerKind,
        chatModel: this.chatModel ?? null,
        visionModel: this.visionModel ?? null,
        embedModel: this.embedModel ?? null,
      },
      'AI 网关初始化',
    );
  }

  capabilities(): CapabilityState {
    return {
      chat: this.provider !== null && Boolean(this.chatModel),
      vision: this.provider !== null && Boolean(this.visionModel),
      embed: this.provider !== null && Boolean(this.embedModel),
    };
  }

  /** 是否有任何富化能力（决定归档时是否入队 ai.enrich） */
  get enrichEnabled(): boolean {
    const caps = this.capabilities();
    return caps.chat || caps.vision;
  }

  startRun(kind: RunKind, userRequest?: string): number {
    const row = this.db
      .insert(aiRuns)
      .values({
        kind,
        userRequest: userRequest ?? null,
        status: 'running',
        provider: this.providerKind,
        model: this.chatModel ?? null,
      })
      .returning({ id: aiRuns.id })
      .get();
    this.stepCounters.set(row.id, 0);
    return row.id;
  }

  finishRun(
    runId: number,
    status: 'succeeded' | 'failed' | 'cancelled',
    opts: { error?: string; totalTokens?: number } = {},
  ): void {
    const totalTokens = opts.totalTokens ?? this.runTokens.get(runId) ?? null;
    this.db
      .update(aiRuns)
      .set({
        status,
        finishedAt: new Date(),
        error: opts.error ?? null,
        totalTokens,
      })
      .where(eq(aiRuns.id, runId))
      .run();
    this.stepCounters.delete(runId);
    this.runTokens.delete(runId);
  }

  private addTokens(runId: number, tokens: number): void {
    this.runTokens.set(runId, (this.runTokens.get(runId) ?? 0) + tokens);
  }

  recordStep(runId: number, step: StepInput): void {
    const next = this.stepCounters.get(runId) ?? 0;
    this.stepCounters.set(runId, next + 1);
    this.db
      .insert(aiSteps)
      .values({
        runId,
        stepIndex: next,
        type: step.type,
        toolName: step.toolName ?? null,
        input: step.input ?? null,
        output: step.output ?? null,
        status: step.status,
        latencyMs: step.latencyMs ?? null,
        tokenUsage: step.tokenUsage ?? null,
        error: step.error ?? null,
      })
      .run();
  }

  /** 便捷包装：创建 run → 执行 → 落终态 */
  async withRun<T>(
    kind: RunKind,
    userRequest: string | undefined,
    fn: (runId: number) => Promise<T>,
  ): Promise<T> {
    const runId = this.startRun(kind, userRequest);
    try {
      const result = await fn(runId);
      this.finishRun(runId, 'succeeded');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.recordStep(runId, { type: 'error', status: 'failed', error: message });
      this.finishRun(runId, 'failed', { error: message });
      throw err;
    }
  }

  async runChat(
    req: ChatRequest,
    opts: { runId?: number; label?: string } = {},
  ): Promise<ChatResponse> {
    if (!this.provider) throw new Error('AI provider 未启用');
    const model = req.model ?? this.chatModel;
    if (!model) throw new Error('未配置 AI_CHAT_MODEL');
    const response = await this.provider.chat({ ...req, model });
    if (opts.runId !== undefined) {
      this.addTokens(opts.runId, response.usage.totalTokens);
      this.recordStep(opts.runId, {
        type: 'model_call',
        toolName: opts.label ?? 'chat',
        input: { model, messages: req.messages.length, jsonMode: req.jsonMode ?? false },
        output: {
          text: response.text.slice(0, 2_000),
          reasoning: response.reasoning ? response.reasoning.slice(0, 800) : undefined,
          finishReason: response.finishReason,
        },
        status: 'succeeded',
        latencyMs: response.latencyMs,
        tokenUsage: response.usage,
      });
    }
    return response;
  }

  async runVision(
    req: VisionRequest,
    opts: { runId?: number; label?: string } = {},
  ): Promise<ChatResponse> {
    if (!this.provider) throw new Error('AI provider 未启用');
    const model = req.model ?? this.visionModel;
    if (!model) throw new Error('未配置 AI_VLM_MODEL');
    const response = await this.provider.vision({ ...req, model });
    if (opts.runId !== undefined) {
      this.addTokens(opts.runId, response.usage.totalTokens);
      this.recordStep(opts.runId, {
        type: 'model_call',
        toolName: opts.label ?? 'vision',
        input: { model, images: req.images.length },
        output: {
          text: response.text.slice(0, 2_000),
          reasoning: response.reasoning ? response.reasoning.slice(0, 800) : undefined,
          finishReason: response.finishReason,
        },
        status: 'succeeded',
        latencyMs: response.latencyMs,
        tokenUsage: response.usage,
      });
    }
    return response;
  }

  async runEmbed(
    req: EmbedRequest,
    opts: { runId?: number; label?: string } = {},
  ): Promise<EmbedResponse> {
    if (!this.provider) throw new Error('AI provider 未启用');
    const model = req.model ?? this.embedModel;
    if (!model) throw new Error('未配置 AI_EMBED_MODEL');
    const started = Date.now();
    const response = await this.provider.embed({ ...req, model });
    if (opts.runId !== undefined) {
      this.recordStep(opts.runId, {
        type: 'model_call',
        toolName: opts.label ?? 'embed',
        input: { model, inputs: req.input.length },
        output: { dimensions: response.dimensions, count: response.vectors.length },
        status: 'succeeded',
        latencyMs: Date.now() - started,
        tokenUsage: response.usage,
      });
    }
    return response;
  }
}
