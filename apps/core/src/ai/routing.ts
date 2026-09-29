/**
 * AI 介入分流器：按「转发来源」决定这条内容**要不要进模型**。
 *
 * 背景：AI 是外部 API、带内容审核，敏感收藏必然被拒答。因此把「不进模型」做成
 * 一等公民——命中跳过策略的内容直接进人工分类队列（`ai_status='manual'`），
 * 不产生任何 `ai_runs` 记录。
 *
 * 来源 key 的四种形态（对应 Telegram 的四种转发来源）：
 *   channel:<chatId>   转发自频道
 *   chat:<chatId>      转发自群/以群身份发送
 *   user:<userId>      转发自个人（含「转发自群但原发送者未隐藏」——Bot API 只会给出这个人）
 *   name:<senderName>  仅名字可见（hidden_user），没有 ID 可锚定
 */
import { SETTING_KEYS, type SourceKeyType } from '@tma/shared';
import type { AppContext } from '../context.js';
import { getSetting } from '../settings/store.js';
import type { ForwardOrigin } from '../telegram/types.js';

export interface AiPolicyDecision {
  /** 是否跳过 AI */
  skip: boolean;
  /** 命中的来源 key（仅 skip=true 时有值） */
  matchedKey?: string;
  /** 本条消息的来源 key（用于落库与统计；非转发消息为 undefined） */
  sourceKey?: string;
}

/** ForwardOrigin → 策略 key；无法锚定（如无 ID 且无名字）时返回 undefined */
export function forwardSourceKey(forward?: ForwardOrigin): string | undefined {
  if (!forward) return undefined;
  switch (forward.originType) {
    case 'channel':
      return forward.chatId != null ? `channel:${forward.chatId}` : undefined;
    case 'chat':
      return forward.chatId != null ? `chat:${forward.chatId}` : undefined;
    case 'user':
      return forward.senderUserId != null ? `user:${forward.senderUserId}` : undefined;
    case 'hidden_user': {
      const name = forward.senderName?.trim();
      return name ? `name:${name}` : undefined;
    }
    default:
      return undefined;
  }
}

export function parseSourceKey(key: string): { type: SourceKeyType; value: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const type = key.slice(0, idx);
  const value = key.slice(idx + 1);
  if (!value) return null;
  if (type !== 'channel' && type !== 'chat' && type !== 'user' && type !== 'name') return null;
  return { type, value };
}

/** 读取跳过列表（容错：settings 里可能是脏数据） */
export function getSkipSources(ctx: AppContext): string[] {
  const raw = getSetting<unknown>(ctx, SETTING_KEYS.aiSkipSources);
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export function resolveAiPolicy(ctx: AppContext, forward?: ForwardOrigin): AiPolicyDecision {
  const sourceKey = forwardSourceKey(forward);
  if (!sourceKey) return { skip: false };
  const skip = getSkipSources(ctx).includes(sourceKey);
  return skip ? { skip: true, matchedKey: sourceKey, sourceKey } : { skip: false, sourceKey };
}

/** 该来源 key 是否在跳过列表中 */
export function isSourceSkipped(ctx: AppContext, sourceKey: string): boolean {
  return getSkipSources(ctx).includes(sourceKey);
}
