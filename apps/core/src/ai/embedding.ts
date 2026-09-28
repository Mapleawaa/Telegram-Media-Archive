import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { SETTING_KEYS } from '@tma/shared';
import type { AppContext } from '../context.js';
import {
  mediaAsset,
  mediaEmbedding,
  mediaMetadata,
  mediaTag,
  telegramMessage,
} from '../database/schema.js';
import { setSetting } from '../settings/store.js';
import { ensureVecTable, upsertVector } from '../vector/store.js';
import type { AiGateway } from './gateway.js';

export interface EmbeddingDoc {
  doc: string;
  hash: string;
}

export function buildEmbeddingDoc(ctx: AppContext, assetId: number): EmbeddingDoc | null {
  const { db } = ctx;
  const asset = db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  if (!asset) return null;

  const meta = db
    .select()
    .from(mediaMetadata)
    .where(eq(mediaMetadata.mediaAssetId, assetId))
    .get();
  const primary = asset.preferredMessageId
    ? db
        .select()
        .from(telegramMessage)
        .where(eq(telegramMessage.id, asset.preferredMessageId))
        .get()
    : undefined;
  const tags = db
    .select({ tag: mediaTag.tag })
    .from(mediaTag)
    .where(eq(mediaTag.mediaAssetId, assetId))
    .all();

  const title = asset.canonicalTitle ?? meta?.titleNorm ?? meta?.fileName ?? `媒体 #${assetId}`;
  const structured = [
    asset.type,
    meta?.quality,
    meta?.year,
    meta?.season != null ? `S${meta.season}E${meta.episode ?? '?'}` : undefined,
    meta?.codec,
    meta?.source,
  ]
    .filter(Boolean)
    .join(' / ');

  const parts = [
    `标题: ${title}`,
    meta?.summary ? `摘要: ${meta.summary}` : undefined,
    tags.length > 0 ? `标签: ${tags.map((t) => t.tag).join(', ')}` : undefined,
    primary?.caption ? `附言: ${primary.caption}` : undefined,
    meta?.fileName ? `文件名: ${meta.fileName}` : undefined,
    structured ? `属性: ${structured}` : undefined,
  ].filter((v): v is string => Boolean(v));

  const doc = parts.join('\n');
  const hash = createHash('sha256').update(doc).digest('hex');
  return { doc, hash };
}

export interface EmbedAssetResult {
  status: 'created' | 'cached';
  dim: number;
  model: string;
}

/**
 * 计算并存储媒体向量。content_hash 命中时直接复用（不重复计费）；
 * 维度变化由 ensureVecTable 处理（重建向量表 + 清旧记录）。
 */
export async function embedAsset(
  ctx: AppContext,
  gateway: AiGateway,
  assetId: number,
): Promise<EmbedAssetResult> {
  const built = buildEmbeddingDoc(ctx, assetId);
  if (!built) throw new Error(`媒体不存在: #${assetId}`);
  const model = gateway.runtimes.embed.model;
  if (!model) throw new Error('未配置 AI_EMBED_MODEL');

  const existing = ctx.db
    .select()
    .from(mediaEmbedding)
    .where(
      and(
        eq(mediaEmbedding.mediaAssetId, assetId),
        eq(mediaEmbedding.kind, 'text'),
        eq(mediaEmbedding.model, model),
      ),
    )
    .get();

  if (existing && existing.contentHash === built.hash) {
    return { status: 'cached', dim: existing.dim, model };
  }

  let storedDim = 0;
  await gateway.withRun('embedding', `向量化媒体 #${assetId}`, async (runId) => {
    const response = await gateway.runEmbed(
      { input: [built.doc] },
      { runId, label: 'embedding.create' },
    );
    const vector = response.vectors[0];
    if (!vector || vector.length === 0) throw new Error('embedding 返回空向量');

    ensureVecTable(ctx.sqlite, response.dimensions, ctx.logger);
    upsertVector(ctx.sqlite, assetId, vector);

    const values = {
      mediaAssetId: assetId,
      kind: 'text' as const,
      model,
      dim: response.dimensions,
      contentHash: built.hash,
      sourceDoc: { doc: built.doc.slice(0, 2_000) },
      createdAt: new Date(),
    };
    ctx.db
      .insert(mediaEmbedding)
      .values(values)
      .onConflictDoUpdate({
        target: [mediaEmbedding.mediaAssetId, mediaEmbedding.kind, mediaEmbedding.model],
        set: values,
      })
      .run();

    setSetting(ctx, SETTING_KEYS.embeddingModel, model);
    setSetting(ctx, SETTING_KEYS.embeddingDim, response.dimensions);
    storedDim = response.dimensions;
  });

  return { status: 'created', dim: storedDim, model };
}
