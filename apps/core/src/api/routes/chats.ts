import type { SeenChatItem, SeenChatsResponse } from '@tma/shared';
import type { AppContext } from '../../context.js';
import type { AppServer } from '../types.js';

/**
 * Bot「见过的 chat」（P5-4 / B14）：从 telegram_message 聚合。
 * 不需要新表——只要 Bot 收到过消息，这里就有记录。
 *
 * 归档群本身会标出来：转发目标不该选它（转给自己没有意义）。
 */
export function registerChatsRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/chats', async (): Promise<SeenChatsResponse> => {
    const rows = ctx.sqlite
      .prepare(
        `SELECT chat_id AS chatId,
                MAX(chat_title) AS chatTitle,
                MAX(chat_type) AS chatType,
                COUNT(*) AS count,
                MAX(message_date) AS lastSeenAt
         FROM telegram_message
         GROUP BY chat_id
         ORDER BY lastSeenAt DESC`,
      )
      .all() as {
      chatId: number;
      chatTitle: string | null;
      chatType: string | null;
      count: number;
      lastSeenAt: number;
    }[];

    const archive = ctx.config.TG_ARCHIVE_CHAT_ID;
    const items: SeenChatItem[] = rows.map((r) => ({
      ...r,
      isArchive: r.chatId === archive,
    }));

    return { items };
  });
}
