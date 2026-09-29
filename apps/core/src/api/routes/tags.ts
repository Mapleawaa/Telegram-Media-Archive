import type { TagCountItem, TagTopResponse } from '@tma/shared';
import type { AppContext } from '../../context.js';
import type { AppServer } from '../types.js';

const SOURCES = new Set(['user', 'rule', 'llm', 'vision']);

/**
 * 常用标签 Top N：人工分类面板的「历史常用」候选。
 * `source` 缺省为 `user`（用户自己打过的标签最有参考价值）。
 */
export function registerTagsRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/tags/top', async (req): Promise<TagTopResponse> => {
    const query = (req.query ?? {}) as { source?: string; limit?: string };
    const source = query.source && SOURCES.has(query.source) ? query.source : 'user';
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    const rows = ctx.sqlite
      .prepare(
        `SELECT tag, COUNT(*) AS count
         FROM media_tag
         WHERE source = ?
         GROUP BY tag
         ORDER BY count DESC, tag ASC
         LIMIT ?`,
      )
      .all(source, limit) as TagCountItem[];

    return { items: rows };
  });
}
