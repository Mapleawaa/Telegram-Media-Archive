import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { mediaAsset, mediaMetadata, mediaTag } from '../../database/schema.js';
import { rebuildSearchDoc } from '../../metadata/rebuild-search-doc.js';
import { extractHashtags } from '../../metadata/rule-parser.js';
import { pruneAssetTags } from '../../metadata/tag-policy.js';
import { cleanRuleTitle, isBadAiTitleLike, isJunkTitle } from '../../metadata/title-policy.js';
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
    let tagsRemoved = 0;
    let titlesCleared = 0;
    let titlesCleaned = 0;
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

      // 2) 历史坏标题清理（模型拒答句被落库的情况）+ 标签治理 + 搜索文档重建
      const ids = (
        ctx.sqlite.prepare(`SELECT id FROM media_asset ORDER BY id`).all() as { id: number }[]
      ).map((r) => r.id);
      const titleRows = ctx.sqlite
        .prepare(
          `SELECT a.id, a.canonical_title AS title, m.title_norm AS titleNorm
           FROM media_asset a LEFT JOIN media_metadata m ON m.media_asset_id = a.id`,
        )
        .all() as { id: number; title: string | null; titleNorm: string | null }[];
      for (const row of titleRows) {
        // a) 规则标题推广尾巴清理（title_norm 与作为其副本的 canonical_title 同步）
        if (row.titleNorm) {
          const cleaned = cleanRuleTitle(row.titleNorm);
          if (cleaned !== row.titleNorm) {
            ctx.db
              .update(mediaMetadata)
              .set({ titleNorm: cleaned || null, updatedAt: new Date() })
              .where(eq(mediaMetadata.mediaAssetId, row.id))
              .run();
            if (row.title === row.titleNorm) {
              ctx.db
                .update(mediaAsset)
                .set({ canonicalTitle: cleaned || null, updatedAt: new Date() })
                .where(eq(mediaAsset.id, row.id))
                .run();
            }
            titlesCleaned += 1;
          }
        }
        // b) 历史坏标题清理（模型拒答句被落库）
        if (isBadAiTitleLike(row.title) && isJunkTitle(row.titleNorm)) {
          ctx.db
            .update(mediaAsset)
            .set({ canonicalTitle: null, updatedAt: new Date() })
            .where(eq(mediaAsset.id, row.id))
            .run();
          titlesCleared += 1;
        }
      }
      for (const id of ids) {
        tagsRemoved += pruneAssetTags(ctx, id);
        rebuildSearchDoc(ctx, id);
      }
    });
    tx();

    const count = (
      ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM media_asset`).get() as { n: number }
    ).n;

    return {
      ok: true,
      count,
      tagsAdded,
      tagsRemoved,
      titlesCleared,
      titlesCleaned,
      tookMs: Date.now() - started,
    };
  });

  app.post('/api/admin/reindex-embeddings', async (_req, reply) => {
    if (!ctx.ai.embedEnabled) {
      return reply.status(400).send({
        error: 'embed_disabled',
        message: '未配置 embedding 能力：请设置 AI_EMBED_MODEL（可选 AI_EMBED_BASE_URL / AI_EMBED_API_KEY）',
      });
    }
    const ids = (
      ctx.sqlite.prepare(`SELECT id FROM media_asset ORDER BY id`).all() as { id: number }[]
    ).map((r) => r.id);

    let enqueued = 0;
    for (const id of ids) {
      const jobId = ctx.queue.enqueue(
        'embedding.create',
        { mediaId: id },
        { dedupeKey: `embedding.create:${id}`, priority: 1 },
      );
      if (jobId !== undefined) enqueued += 1;
    }
    return { ok: true, total: ids.length, enqueued };
  });
}
