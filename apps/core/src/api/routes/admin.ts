import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { ConsolidateTagsResponse } from '@tma/shared';
import { reparseAsset } from '../../metadata/reparse.js';
import type { AppContext } from '../../context.js';
import { mediaAsset, mediaMetadata, mediaTag } from '../../database/schema.js';
import { backfillRuleCategory } from '../../metadata/category.js';
import { rebuildSearchDoc } from '../../metadata/rebuild-search-doc.js';
import { extractHashtags } from '../../metadata/rule-parser.js';
import { filterTags, pruneAssetTags } from '../../metadata/tag-policy.js';
import {
  cleanRuleTitle,
  deriveTitleFromDescription,
  isBadAiTitleLike,
  isJunkTitle,
} from '../../metadata/title-policy.js';
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
    let titlesRederived = 0;
    let categoriesFilled = 0;
    const tx = ctx.sqlite.transaction(() => {
      for (const m of messages) {
        let entities: unknown;
        try {
          entities = m.captionEntities ? JSON.parse(m.captionEntities) : undefined;
        } catch {
          entities = undefined;
        }
        // 与 ingest 保持一致：先过 filterTags 归一化 + 低价值过滤，
        // 否则低价值 hashtag 会被反复回填、又被 prune 删掉（治理不收敛）
        for (const tag of filterTags(extractHashtags(m.caption, entities), new Set())) {
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
        ctx.sqlite.prepare(`SELECT id FROM media_asset WHERE deleted_at IS NULL ORDER BY id`).all() as { id: number }[]
      ).map((r) => r.id);
      const titleRows = ctx.sqlite
        .prepare(
          `SELECT a.id, a.canonical_title AS title, m.title_norm AS titleNorm, m.summary AS summary
           FROM media_asset a LEFT JOIN media_metadata m ON m.media_asset_id = a.id
           WHERE a.deleted_at IS NULL`,
        )
        .all() as {
        id: number;
        title: string | null;
        titleNorm: string | null;
        summary: string | null;
      }[];
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
          continue;
        }
        // c) 历史「按字数硬切」的派生标题：若它是摘要某一行的前缀，
        //    用改进后的按标点断句重新生成（真实案例：「…白西装坐皮椅持杖，身后黑」）
        if (row.title && row.summary) {
          const sourceLine = row.summary
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith(row.title!) && l.length > row.title!.length);
          if (sourceLine) {
            const better = deriveTitleFromDescription(sourceLine);
            if (better && better !== row.title) {
              ctx.db
                .update(mediaAsset)
                .set({ canonicalTitle: better, updatedAt: new Date() })
                .where(eq(mediaAsset.id, row.id))
                .run();
              titlesRederived += 1;
            }
          }
        }
      }
      for (const id of ids) {
        tagsRemoved += pruneAssetTags(ctx, id);
        // P3-1 分类回填：只补空缺（不覆盖 llm/user 已有分类）
        if (backfillRuleCategory(ctx, id)) categoriesFilled += 1;
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
      titlesRederived,
      categoriesFilled,
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
      ctx.sqlite.prepare(`SELECT id FROM media_asset WHERE deleted_at IS NULL ORDER BY id`).all() as { id: number }[]
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

  /**
   * 批量标签压缩（P3-2，U5）：给全部媒体入队 `tags.consolidate`。
   * 只输入标签列表（不看内容）→ 模型归并 → 应用。user 标签不可被删/并。
   * 只对「有标签」的媒体入队，避免空跑烧 token。
   */
  app.post('/api/admin/consolidate-tags', async (_req, reply): Promise<ConsolidateTagsResponse | undefined> => {
    if (!ctx.ai.chatEnabled) {
      await reply.status(400).send({
        error: 'chat_disabled',
        message: '未配置文本模型（AI_CHAT_MODEL）：标签压缩需要 chat 能力',
      });
      return;
    }
    const ids = (
      ctx.sqlite
        .prepare(`SELECT DISTINCT t.media_asset_id AS id
         FROM media_tag t JOIN media_asset a ON a.id = t.media_asset_id
         WHERE a.deleted_at IS NULL ORDER BY id`)
        .all() as { id: number }[]
    ).map((r) => r.id);

    let enqueued = 0;
    for (const id of ids) {
      const jobId = ctx.queue.enqueue(
        'tags.consolidate',
        { mediaId: id },
        { dedupeKey: `tags.consolidate:${id}`, priority: 0 },
      );
      if (jobId !== undefined) enqueued += 1;
    }
    return { ok: true, total: ids.length, enqueued };
  });

  /**
   * 批量重解析（P5-2 / B9）：规则升级后全量重跑确定性规则。
   * 不碰 AI 产物、不花 token；跳过已软删除的媒体。
   */
  app.post('/api/admin/reparse-all', async () => {
    const started = Date.now();
    const ids = (
      ctx.sqlite
        .prepare(`SELECT id FROM media_asset WHERE deleted_at IS NULL ORDER BY id`)
        .all() as { id: number }[]
    ).map((r) => r.id);

    let changed = 0;
    let titleChanged = 0;
    let skipped = 0;
    for (const id of ids) {
      const r = reparseAsset(ctx, id);
      if (!r.ok) {
        skipped += 1;
        continue;
      }
      if (r.changed) changed += 1;
      if (r.titleChanged) titleChanged += 1;
    }
    return {
      ok: true,
      total: ids.length,
      changed,
      titleChanged,
      skipped,
      tookMs: Date.now() - started,
    };
  });

  /**
   * 清空缩略图缓存（P5-5 / D3）：维护三件套之一。
   * 只删 <dataDir>/thumbnails 下的 .jpg（派生数据，可随时从 Telegram 重新下载）。
   */
  app.post('/api/admin/clear-thumbnails', async () => {
    const dir = path.join(ctx.config.dataDir, 'thumbnails');
    if (!fs.existsSync(dir)) return { ok: true, removed: 0, dir };

    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.jpg')) continue;
      const file = path.join(dir, name);
      try {
        fs.rmSync(file, { force: true });
        removed += 1;
      } catch {
        // 单个文件删不掉（被占用）就跳过，不中断
      }
    }
    return { ok: true, removed, dir };
  });
}
