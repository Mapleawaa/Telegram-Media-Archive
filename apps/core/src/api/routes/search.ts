import { SearchRequestSchema, type SearchResponse } from '@tma/shared';
import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';
import { queryMedia } from '../../media/queries.js';
import { searchFts } from '../../search/fts.js';

export function registerSearchRoutes(app: AppServer, ctx: AppContext): void {
  app.post('/api/search', async (req): Promise<SearchResponse> => {
    const started = Date.now();
    const body = SearchRequestSchema.parse(req.body ?? {});

    const fts = searchFts(ctx.sqlite, body.query, Math.max(body.limit * 5, 50));
    const candidateIds = fts.hits.map((h) => h.docId);

    const page =
      candidateIds.length > 0
        ? queryMedia(ctx.sqlite, {
            filters: body.filters,
            limit: body.limit,
            candidateIds,
            order: 'relevance',
          })
        : { items: [], nextCursor: null };

    return {
      items: page.items,
      debug: {
        strategy: fts.strategy,
        ftsHits: fts.hits.length,
        vectorHits: 0,
        reranked: page.items.length,
        tookMs: Date.now() - started,
      },
    };
  });
}
