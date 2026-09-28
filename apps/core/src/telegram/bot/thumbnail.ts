import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { mediaAsset, telegramMessage } from '../../database/schema.js';
import type { TelegramClient } from '../client.js';

export async function ensureThumbnail(
  ctx: AppContext,
  client: TelegramClient,
  assetId: number,
): Promise<string | null> {
  const { db, logger } = ctx;
  const asset = db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  if (!asset) return null;

  const primary = asset.preferredMessageId
    ? db
        .select()
        .from(telegramMessage)
        .where(eq(telegramMessage.id, asset.preferredMessageId))
        .get()
    : undefined;
  if (!primary?.thumbnailFileId) return null;

  const dir = path.join(ctx.config.dataDir, 'thumbnails');
  const dest = path.join(dir, `${asset.fileUniqueId}.jpg`);
  if (fs.existsSync(dest)) return dest;

  try {
    await client.downloadFile(primary.thumbnailFileId, dest);
    logger.debug({ assetId, dest }, '缩略图已缓存');
    return dest;
  } catch (err) {
    logger.warn({ err, assetId }, '缩略图下载失败');
    return null;
  }
}
