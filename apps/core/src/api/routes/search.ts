import { SearchRequestSchema, type SearchResponse } from '@tma/shared';
import type { AppContext } from '../../context.js';
import { hybridSearch } from '../../search/orchestrator.js';
import type { AppServer } from '../types.js';

export function registerSearchRoutes(app: AppServer, ctx: AppContext): void {
  app.post('/api/search', async (req): Promise<SearchResponse> => {
    const body = SearchRequestSchema.parse(req.body ?? {});
    const result = await hybridSearch(ctx, ctx.ai, {
      query: body.query,
      filters: body.filters,
      limit: body.limit,
    });
    return { items: result.items, debug: result.debug };
  });
}
