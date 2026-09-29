import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  mediaAsset,
  mediaMetadata,
  mediaSearchDoc,
  mediaTag,
  telegramMessage,
} from '../database/schema.js';

export function rebuildSearchDoc(ctx: AppContext, assetId: number): void {
  const { db } = ctx;
  const asset = db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  if (!asset) return;

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
  const uniqueTags = [...new Set(tags.map((t) => t.tag))];

  const extra = [
    asset.type,
    meta?.quality,
    meta?.codec,
    meta?.source,
    meta?.audio,
    meta?.year,
    primary?.chatTitle,
  ]
    .filter((v) => v !== null && v !== undefined && v !== '')
    .join(' ');

  const values = {
    docId: assetId,
    title: asset.canonicalTitle ?? meta?.titleNorm ?? meta?.fileName ?? null,
    filename: meta?.fileName ?? null,
    caption: primary?.caption ?? null,
    tags: uniqueTags.join(' ') || null,
    summary: meta?.summary ?? null,
    extra: extra || null,
    updatedAt: new Date(),
  };

  db.insert(mediaSearchDoc)
    .values(values)
    .onConflictDoUpdate({ target: mediaSearchDoc.docId, set: values })
    .run();
}
