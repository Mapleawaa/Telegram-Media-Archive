export type ChatPart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      image: { kind: 'path'; path: string } | { kind: 'base64'; data: string; mime: string };
    };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  text: string;
  /** 推理型模型（如 DeepSeek vision-exp / reasoner）的思维链内容，正文为空时可用于诊断 */
  reasoning?: string;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: ChatUsage;
  model: string;
  latencyMs: number;
}

export interface VisionRequest {
  model?: string;
  prompt: string;
  images: Extract<ChatPart, { type: 'image' }>[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

export interface EmbedRequest {
  model?: string;
  input: string[];
  dimensions?: number;
}

export interface EmbedResponse {
  vectors: number[][];
  model: string;
  dimensions: number;
  usage: { promptTokens: number };
}

export interface ModelInfo {
  id: string;
  kind: 'chat' | 'vision' | 'embedding';
}

export interface AIProvider {
  readonly id: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  vision(req: VisionRequest): Promise<ChatResponse>;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
  listModels?(): Promise<ModelInfo[]>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
