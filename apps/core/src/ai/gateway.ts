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
export type CapabilityName = 'chat' | 'vision' | 'embed';

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

export interface CapabilityRuntime {
  name: CapabilityName;
  model?: string;
  baseUrl?: string;
  provider: AIProvider | null;
  enabled: boolean;
}

export interface CapabilityDescription {
  enabled: boolean;
  model: string | null;
  baseUrl: string | null;
}

export interface CapabilitiesDescription {
  providerKind: AiProviderKind;
  chat: CapabilityDescription;
  vision: CapabilityDescription;
  embed: CapabilityDescription;
}

interface CapabilityConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

function capabilityConfigs(config: AppConfig): Record<CapabilityName, CapabilityConfig> {
  return {
    chat: {
      model: config.AI_CHAT_MODEL,
      baseUrl: config.AI_CHAT_BASE_URL ?? config.AI_BASE_URL,
      apiKey: config.AI_CHAT_API_KEY ?? config.AI_API_KEY,
    },
    vision: {
      model: config.AI_VLM_MODEL,
      baseUrl: config.AI_VLM_BASE_URL ?? config.AI_BASE_URL,
      apiKey: config.AI_VLM_API_KEY ?? config.AI_API_KEY,
    },
    embed: {
      model: config.AI_EMBED_MODEL,
      baseUrl: config.AI_EMBED_BASE_URL ?? config.AI_BASE_URL,
      apiKey: config.AI_EMBED_API_KEY ?? config.AI_API_KEY,
    },
  };
}

function hasCompleteConfig(cfg: CapabilityConfig): boolean {
  return Boolean(cfg.model && cfg.baseUrl && cfg.apiKey);
}

function resolveProviderKind(config: AppConfig): AiProviderKind {
  if (config.AI_PROVIDER !== 'auto') return config.AI_PROVIDER;
  const configs = capabilityConfigs(config);
  return Object.values(configs).some(hasCompleteConfig) ? 'openai' : 'none';
}

export class AiGateway {
  readonly providerKind: AiProviderKind;
  readonly runtimes: Record<CapabilityName, CapabilityRuntime>;
  private readonly stepCounters = new Map<number, number>();
  private readonly runTokens = new Map<number, number>();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    config: AppConfig,
  ) {
    this.providerKind = resolveProviderKind(config);
    const configs = capabilityConfigs(config);
    const mock = this.providerKind === 'mock' ? new MockProvider() : null;

    const build = (name: CapabilityName): CapabilityRuntime => {
      const cfg = configs[name];
      if (this.providerKind === 'none') {
        return { name, model: cfg.model, baseUrl: cfg.baseUrl, provider: null, enabled: false };
      }
      if (mock) {
        // mock 也遵循「配置了哪个模型才启用哪个能力」的规则
        return {
          name,
          model: cfg.model,
          baseUrl: cfg.baseUrl ?? 'mock',
          provider: mock,
          enabled: Boolean(cfg.model),
        };
      }
      if (!hasCompleteConfig(cfg)) {
        return { name, model: cfg.model, baseUrl: cfg.baseUrl, provider: null, enabled: false };
      }
      return {
        name,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        provider: new OpenAICompatibleProvider({
          id: `${name}:openai`,
          baseUrl: cfg.baseUrl!,
          apiKey: cfg.apiKey!,
        }),
        enabled: true,
      };
    };

    this.runtimes = { chat: build('chat'), vision: build('vision'), embed: build('embed') };

    logger.info(
      {
        provider: this.providerKind,
        chat: this.describeCapability('chat'),
        vision: this.describeCapability('vision'),
        embed: this.describeCapability('embed'),
      },
      'AI 网关初始化（各能力独立配置）',
    );
  }

  private describeCapability(name: CapabilityName): string {
    const rt = this.runtimes[name];
    return rt.enabled ? `${rt.model} @ ${rt.baseUrl}` : '未启用';
  }

  describe(): CapabilitiesDescription {
    const pick = (name: CapabilityName): CapabilityDescription => {
      const rt = this.runtimes[name];
      return {
        enabled: rt.enabled,
        model: rt.model ?? null,
        baseUrl: rt.baseUrl ?? null,
      };
    };
    return {
      providerKind: this.providerKind,
      chat: pick('chat'),
      vision: pick('vision'),
      embed: pick('embed'),
    };
  }

  get chatEnabled(): boolean {
    return this.runtimes.chat.enabled;
  }

  get visionEnabled(): boolean {
    return this.runtimes.vision.enabled;
  }

  get embedEnabled(): boolean {
    return this.runtimes.embed.enabled;
  }

  /** 是否有任何富化能力（决定归档时是否入队 ai.enrich） */
  get enrichEnabled(): boolean {
    return this.chatEnabled || this.visionEnabled;
  }

  startRun(kind: RunKind, userRequest?: string): number {
    const model = this.runtimes.chat.model ?? this.runtimes.vision.model ?? null;
    const row = this.db
      .insert(aiRuns)
      .values({
        kind,
        userRequest: userRequest ?? null,
        status: 'running',
        provider: this.providerKind,
        model,
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

  private requireRuntime(name: CapabilityName): CapabilityRuntime {
    const rt = this.runtimes[name];
    if (!rt.provider || !rt.enabled || !rt.model) {
      throw new Error(
        `${name} 能力未启用：请配置 AI_${name.toUpperCase()}_MODEL（可选 AI_${name.toUpperCase()}_BASE_URL / AI_${name.toUpperCase()}_API_KEY 单独指定服务商）`,
      );
    }
    return rt;
  }

  async runChat(
    req: ChatRequest,
    opts: { runId?: number; label?: string } = {},
  ): Promise<ChatResponse> {
    const rt = this.requireRuntime('chat');
    const model = req.model ?? rt.model;
    const response = await rt.provider!.chat({ ...req, model });
    if (opts.runId !== undefined) {
      this.addTokens(opts.runId, response.usage.totalTokens);
      this.recordStep(opts.runId, {
        type: 'model_call',
        toolName: opts.label ?? 'chat',
        input: { model, baseUrl: rt.baseUrl, messages: req.messages.length, jsonMode: req.jsonMode ?? false },
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
    const rt = this.requireRuntime('vision');
    const model = req.model ?? rt.model;
    const response = await rt.provider!.vision({ ...req, model });
    if (opts.runId !== undefined) {
      this.addTokens(opts.runId, response.usage.totalTokens);
      this.recordStep(opts.runId, {
        type: 'model_call',
        toolName: opts.label ?? 'vision',
        input: { model, baseUrl: rt.baseUrl, images: req.images.length },
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
    const rt = this.requireRuntime('embed');
    const model = req.model ?? rt.model;
    const started = Date.now();
    const response = await rt.provider!.embed({ ...req, model });
    if (opts.runId !== undefined) {
      this.recordStep(opts.runId, {
        type: 'model_call',
        toolName: opts.label ?? 'embed',
        input: { model, baseUrl: rt.baseUrl, inputs: req.input.length },
        output: { dimensions: response.dimensions, count: response.vectors.length },
        status: 'succeeded',
        latencyMs: Date.now() - started,
        tokenUsage: response.usage,
      });
    }
    return response;
  }
}
