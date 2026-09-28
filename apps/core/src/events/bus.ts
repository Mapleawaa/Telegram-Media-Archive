import type { EventName } from '@tma/shared';
import type { Logger } from 'pino';
import type { Db } from '../database/client.js';
import { auditEvents, type AUDIT_ACTORS } from '../database/schema.js';

export type AuditActor = (typeof AUDIT_ACTORS)[number];

export interface BusEvent {
  event: EventName;
  payload: Record<string, unknown>;
  actor: AuditActor;
  ts: number;
}

export type BusListener = (evt: BusEvent) => void;

export class EventBus {
  private readonly listeners = new Set<BusListener>();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  emit(
    event: EventName,
    payload: Record<string, unknown> = {},
    actor: AuditActor = 'system',
  ): BusEvent {
    const ts = Date.now();
    try {
      this.db
        .insert(auditEvents)
        .values({
          event,
          actor,
          payload,
          mediaAssetId: typeof payload.mediaId === 'number' ? payload.mediaId : null,
          chatId: typeof payload.chatId === 'number' ? payload.chatId : null,
          createdAt: new Date(ts),
        })
        .run();
    } catch (err) {
      this.logger.error({ err, event }, 'audit_events 写入失败');
    }

    const evt: BusEvent = { event, payload, actor, ts };
    for (const listener of this.listeners) {
      try {
        listener(evt);
      } catch (err) {
        this.logger.error({ err, event }, '事件监听器异常');
      }
    }
    return evt;
  }

  subscribe(listener: BusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
