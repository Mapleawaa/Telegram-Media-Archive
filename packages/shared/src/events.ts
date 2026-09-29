export const EVENT_NAMES = [
  'telegram.message.received',
  'media.created',
  'media.updated',
  'media.analyzed',
  'media.manual_review',
  'media.classified',
  'embedding.created',
  'annotation.created',
  'ai.run.started',
  'ai.step.created',
  'ai.run.completed',
  'telegram.message.forwarded',
  'job.failed',
  'job.retry',
  'source.scan.started',
  'source.scan.progress',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export interface WsEventFrame {
  type: 'event';
  event: EventName;
  ts: number;
  payload: Record<string, unknown>;
}

export interface WsHelloFrame {
  type: 'hello';
  ts: number;
  version: string;
}

export interface WsPingFrame {
  type: 'ping';
  ts: number;
}

export type WsFrame = WsEventFrame | WsHelloFrame | WsPingFrame;
