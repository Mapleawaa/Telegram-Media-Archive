import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { mediaAsset, mediaMetadata, mediaTag, telegramMessage } from '../database/schema.js';
import { buildDedupeKey } from '../metadata/dedupe.js';
import { rebuildSearchDoc } from '../metadata/rebuild-search-doc.js';
import { extractHashtags, parseFilename } from '../metadata/rule-parser.js';
import type { IncomingMessage } from '../telegram/types.js';

export const PARSER_VERSION = 'rule-v1';

export interface IngestResult {
  duplicateDelivery: boolean;
  assetCreated: boolean;
  mergedByDedupe: boolean;
  assetId: number;
  messageRowId: number;
}

export function ingestMessage(ctx: AppContext, msg: IncomingMessage): IngestResult {
  const { db, sqlite, bus } = ctx;

  const tx = sqlite.transaction((): IngestResult => {
    const existing = db
      .select()
      .from(telegramMessage)
      .where(
        and(
          eq(telegramMessage.chatId, msg.chatId),
          eq(telegramMessage.messageId, msg.messageId),
        ),
      )
      .get();
    if (existing) {
      // file_id 会随时间失效，重复投递时顺手刷新（file_unique_id 才是去重锚点）
      db.update(telegramMessage)
        .set({
          fileId: msg.media.fileId,
          thumbnailFileId: existing.thumbnailFileId ?? msg.media.thumbnailFileId ?? null,
        })
        .where(eq(telegramMessage.id, existing.id))
        .run();
      return {
        duplicateDelivery: true,
        assetCreated: false,
        mergedByDedupe: false,
        assetId: existing.mediaAssetId,
        messageRowId: existing.id,
      };
    }

    const parsed = msg.media.fileName ? parseFilename(msg.media.fileName) : {};
    const dedupeKey = buildDedupeKey(
      msg.media.fileName,
      msg.media.size ?? 0,
      msg.media.durationSec ?? null,
    );

    let asset = db
      .select()
      .from(mediaAsset)
      .where(eq(mediaAsset.fileUniqueId, msg.media.fileUniqueId))
      .get();
    let mergedByDedupe = false;
    if (!asset) {
      asset = db
        .select()
        .from(mediaAsset)
        .where(eq(mediaAsset.dedupeKey, dedupeKey))
        .get();
      if (asset) mergedByDedupe = true;
    }

    const caption = msg.caption?.trim() || undefined;
    const canonicalTitle =
      parsed.title ?? caption?.slice(0, 120) ?? msg.media.fileName ?? null;

    let assetCreated = false;
    if (!asset) {
      const created = db
        .insert(mediaAsset)
        .values({
          fileUniqueId: msg.media.fileUniqueId,
          dedupeKey,
          canonicalTitle,
          type: msg.media.kind,
          mime: msg.media.mime ?? null,
          size: msg.media.size ?? 0,
          durationSec: msg.media.durationSec ?? null,
          width: msg.media.width ?? null,
          height: msg.media.height ?? null,
        })
        .returning()
        .get();
      asset = created;
      assetCreated = true;

      db.insert(mediaMetadata)
        .values({
          mediaAssetId: created.id,
          fileName: msg.media.fileName ?? null,
          year: parsed.year ?? null,
          season: parsed.season ?? null,
          episode: parsed.episode ?? null,
          quality: parsed.quality ?? null,
          codec: parsed.codec ?? null,
          source: parsed.source ?? null,
          audio: parsed.audio ?? null,
          titleNorm: parsed.title ?? null,
          extractedBy: 'rule',
          parserVersion: PARSER_VERSION,
          rawParse: parsed,
        })
        .run();
    }

    const isPrimary = asset.preferredMessageId === null;
    const messageRow = db
      .insert(telegramMessage)
      .values({
        mediaAssetId: asset.id,
        chatId: msg.chatId,
        messageId: msg.messageId,
        chatType: msg.chatType ?? null,
        chatTitle: msg.chatTitle ?? null,
        mediaGroupId: msg.mediaGroupId ?? null,
        senderId: msg.senderId ?? null,
        senderName: msg.senderName ?? null,
        fileId: msg.media.fileId,
        fileUniqueId: msg.media.fileUniqueId,
        thumbnailFileId: msg.media.thumbnailFileId ?? null,
        caption: caption ?? null,
        captionEntities: msg.captionEntities ?? null,
        messageDate: new Date(msg.messageDate),
        via: 'bot',
        isPrimary,
      })
      .returning({ id: telegramMessage.id })
      .get();

    // 附言 hashtag → 确定性规则标签（source='rule'，可追溯到出处）
    const hashtags = extractHashtags(caption, msg.captionEntities);
    for (const tag of hashtags) {
      db.insert(mediaTag)
        .values({ mediaAssetId: asset.id, tag, source: 'rule' })
        .onConflictDoNothing()
        .run();
    }

    if (isPrimary) {
      db.update(mediaAsset)
        .set({ preferredMessageId: messageRow.id, updatedAt: new Date() })
        .where(eq(mediaAsset.id, asset.id))
        .run();
    } else {
      db.update(mediaAsset)
        .set({ updatedAt: new Date() })
        .where(eq(mediaAsset.id, asset.id))
        .run();
    }

    // AI 富化：启用时入队（同 asset 去重），未启用时直接标记 skipped
    if (assetCreated) {
      if (ctx.ai.enrichEnabled) {
        ctx.queue.enqueue(
          'ai.enrich',
          { mediaId: asset.id },
          { dedupeKey: `ai.enrich:${asset.id}`, priority: 1 },
        );
      } else {
        db.update(mediaAsset)
          .set({ aiStatus: 'skipped', updatedAt: new Date() })
          .where(eq(mediaAsset.id, asset.id))
          .run();
      }
    }

    rebuildSearchDoc(ctx, asset.id);

    bus.emit(
      'telegram.message.received',
      { mediaId: asset.id, chatId: msg.chatId, messageId: msg.messageId },
      'bot',
    );
    bus.emit(
      assetCreated ? 'media.created' : 'media.updated',
      { mediaId: asset.id, deduped: mergedByDedupe },
      'bot',
    );

    return {
      duplicateDelivery: false,
      assetCreated,
      mergedByDedupe,
      assetId: asset.id,
      messageRowId: messageRow.id,
    };
  });

  return tx();
}
