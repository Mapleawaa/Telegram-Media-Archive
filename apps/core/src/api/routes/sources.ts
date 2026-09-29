import type { SourceForwardItem, SourceKeyType, SourcesForwardResponse } from '@tma/shared';
import type { AppContext } from '../../context.js';
import { getSkipSources } from '../../ai/routing.js';
import type { AppServer } from '../types.js';

interface RawSourceRow {
  key: string | null;
  originType: string;
  chatId: number | null;
  title: string | null;
  username: string | null;
  name: string | null;
  count: number;
  lastSeenAt: number;
  skippedCount: number;
}

const KEY_TYPE: Record<string, SourceKeyType> = {
  channel: 'channel',
  chat: 'chat',
  user: 'user',
  hidden_user: 'name',
};

/**
 * 观察到的转发来源列表（供「来源与 AI 策略」面板）。
 *
 * 来源 key 在 SQL 里按 Telegram 四种 origin 归一化后分组；
 * `skippedCount` = 该来源下已被判为 `ai_status='manual'` 的媒体数。
 */
export function registerSourcesRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/sources/forward', async (): Promise<SourcesForwardResponse> => {
    const rows = ctx.sqlite
      .prepare(
        `SELECT
           CASE tm.forward_origin_type
             WHEN 'channel' THEN 'channel:' || tm.forward_from_chat_id
             WHEN 'chat' THEN 'chat:' || tm.forward_from_chat_id
             WHEN 'user' THEN 'user:' || tm.forward_sender_user_id
             WHEN 'hidden_user' THEN 'name:' || tm.forward_sender_name
           END AS key,
           tm.forward_origin_type AS originType,
           MAX(tm.forward_from_chat_id) AS chatId,
           MAX(tm.forward_from_chat_title) AS title,
           MAX(tm.forward_from_chat_username) AS username,
           MAX(tm.forward_sender_name) AS name,
           COUNT(*) AS count,
           MAX(tm.message_date) AS lastSeenAt,
           SUM(CASE WHEN a.ai_status = 'manual' THEN 1 ELSE 0 END) AS skippedCount
         FROM telegram_message tm
         LEFT JOIN media_asset a ON a.id = tm.media_asset_id
         WHERE tm.forward_origin_type IS NOT NULL
         GROUP BY key
         ORDER BY count DESC, key ASC`,
      )
      .all() as RawSourceRow[];

    const items: SourceForwardItem[] = rows
      .filter((r): r is RawSourceRow & { key: string } => typeof r.key === 'string' && r.key.length > 0)
      .map((r) => ({
        key: r.key,
        type: KEY_TYPE[r.originType] ?? 'name',
        chatId: r.chatId,
        title: r.title,
        username: r.username,
        name: r.name,
        count: r.count,
        lastSeenAt: r.lastSeenAt,
        skippedCount: r.skippedCount ?? 0,
      }));

    return { items, skipSources: getSkipSources(ctx) };
  });
}
