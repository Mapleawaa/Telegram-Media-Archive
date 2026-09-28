import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';
import { rebuildSearchDoc } from '../../metadata/rebuild-search-doc.js';

export function registerAdminRoutes(app: AppServer, ctx: AppContext): void {
  app.post('/api/admin/reindex-search', async () => {
    const started = Date.now();
    const ids = (
      ctx.sqlite.prepare(`SELECT id FROM media_asset ORDER BY id`).all() as { id: number }[]
    ).map((r) => r.id);

    const tx = ctx.sqlite.transaction(() => {
      for (const id of ids) rebuildSearchDoc(ctx, id);
    });
    tx();

    return { ok: true, count: ids.length, tookMs: Date.now() - started };
  });
}
