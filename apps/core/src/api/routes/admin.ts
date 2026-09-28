import type { AppContext } from '../../context.js';
import { mediaTag } from '../../database/schema.js';
import { rebuildSearchDoc } from '../../metadata/rebuild-search-doc.js';
import { extractHashtags } from '../../metadata/rule-parser.js';
import type { AppServer } from '../types.js';

export function registerAdminRoutes(app: AppServer, ctx: AppContext): void {
  app.post('/api/admin/reindex-search', async () => {
    const started = Date.now();

    // 1) 规则标签回填：从各来源消息的附言重新提取 hashtag（幂等，可反复执行）
    const messages = ctx.sqlite
      .prepare(
        `SELECT media_asset_id AS assetId, caption, caption_entities AS captionEntities
         FROM telegram_message WHERE caption IS NOT NULL`,
      )
      .all() as { assetId: number; caption: string; captionEntities: string | null }[];

    let tagsAdded = 0;
    const tx = ctx.sqlite.transaction(() => {
      for (const m of messages) {
        let entities: unknown;
        try {
          entities = m.captionEntities ? JSON.parse(m.captionEntities) : undefined;
        } catch {
          entities = undefined;
        }
        for (const tag of extractHashtags(m.caption, entities)) {
          const info = ctx.db
            .insert(mediaTag)
            .values({ mediaAssetId: m.assetId, tag, source: 'rule' })
            .onConflictDoNothing()
            .run();
          tagsAdded += info.changes;
        }
      }

      // 2) 搜索文档重建
      const ids = (
        ctx.sqlite.prepare(`SELECT id FROM media_asset ORDER BY id`).all() as { id: number }[]
      ).map((r) => r.id);
      for (const id of ids) rebuildSearchDoc(ctx, id);
    });
    tx();

    const count = (
      ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM media_asset`).get() as { n: number }
    ).n;

    return { ok: true, count, tagsAdded, tookMs: Date.now() - started };
  });
}
