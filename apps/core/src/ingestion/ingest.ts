import { and, eq } from 'drizzle-orm';
import { resolveAiPolicy } from '../ai/routing.js';
import type { AppContext } from '../context.js';
import { mediaAsset, mediaMetadata, mediaTag, telegramMessage } from '../database/schema.js';
import { buildDedupeKey } from '../metadata/dedupe.js';
import { applyDerivedCategory } from '../metadata/category.js';
import { rebuildSearchDoc } from '../metadata/rebuild-search-doc.js';
import { extractHashtags, parseFilename } from '../metadata/rule-parser.js';
import { filterTags, pruneAssetTags } from '../metadata/tag-policy.js';
import { cleanRuleTitle } from '../metadata/title-policy.js';
import type { ForwardOriginType, IncomingMessage } from '../telegram/types.js';

export const PARSER_VERSION = 'rule-v1';

export interface IngestResult {
  duplicateDelivery: boolean;
  assetCreated: boolean;
  mergedByDedupe: boolean;
  assetId: number;
  messageRowId: number;
}

/** IncomingMessage.forward → telegram_message 的 forward_* 列 */
function forwardColumns(msg: IncomingMessage): {
  forwardOriginType: ForwardOriginType | null;
  forwardFromChatId: number | null;
  forwardFromChatTitle: string | null;
  forwardFromChatUsername: string | null;
  forwardSenderUserId: number | null;
  forwardSenderName: string | null;
} {
  const f = msg.forward;
  return {
    forwardOriginType: f?.originType ?? null,
    forwardFromChatId: f?.chatId ?? null,
    forwardFromChatTitle: f?.chatTitle ?? null,
    forwardFromChatUsername: f?.chatUsername ?? null,
    forwardSenderUserId: f?.senderUserId ?? null,
    forwardSenderName: f?.senderName ?? null,
  };
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
      // file_id 会随时间失效，重复投递时顺手刷新（file_unique_id 才是去重锚点）；
      // 转发来源字段也一并回填（旧版本入库时没有这些列）
      db.update(telegramMessage)
        .set({
          fileId: msg.media.fileId,
          thumbnailFileId: existing.thumbnailFileId ?? msg.media.thumbnailFileId ?? null,
          ...forwardColumns(msg),
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
    const dedupeKey = buildDedupeKey({
      fileName: msg.media.fileName,
      size: msg.media.size ?? 0,
      durationSec: msg.media.durationSec ?? null,
      fileUniqueId: msg.media.fileUniqueId,
    });

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
    const cleanedRuleTitle = parsed.title ? cleanRuleTitle(parsed.title) || undefined : undefined;
    const canonicalTitle =
      cleanedRuleTitle ?? caption?.slice(0, 120) ?? msg.media.fileName ?? null;

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
          titleNorm: cleanedRuleTitle ?? null,
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
        ...forwardColumns(msg),
        messageDate: new Date(msg.messageDate),
        via: 'bot',
        isPrimary,
      })
      .returning({ id: telegramMessage.id })
      .get();

    // 附言 hashtag → 确定性规则标签（source='rule'，可追溯到出处）；低价值词在此过滤
    const hashtags = filterTags(extractHashtags(caption, msg.captionEntities), new Set());
    for (const tag of hashtags) {
      db.insert(mediaTag)
        .values({ mediaAssetId: asset.id, tag, source: 'rule' })
        .onConflictDoNothing()
        .run();
    }
    pruneAssetTags(ctx, asset.id);

    // P3-1 分类（规则层）：新建 asset 立刻落确定性分类
    // （文件名的季集→series；图片→gallery）。AI 富化后续会以 'llm' 覆盖它。
    if (assetCreated) {
      applyDerivedCategory(ctx, asset.id);
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

    // AI 介入分流器：命中「跳过 AI」来源策略 → 完全不进模型，直接进人工分类队列。
    // 只对新建 asset 生效——已富化的 asset 被黑名单来源二次转发时，不应被降级。
    const policy = resolveAiPolicy(ctx, msg.forward);
    let manualReview = false;

    if (assetCreated) {
      if (policy.skip) {
        manualReview = true;
        db.update(mediaAsset)
          .set({ aiStatus: 'manual', aiSkip: true, updatedAt: new Date() })
          .where(eq(mediaAsset.id, asset.id))
          .run();
      } else if (ctx.ai.enrichEnabled) {
        // AI 富化：启用时入队（同 asset 去重）
        ctx.queue.enqueue(
          'ai.enrich',
          { mediaId: asset.id },
          { dedupeKey: `ai.enrich:${asset.id}`, priority: 1 },
        );
      } else if (ctx.ai.embedEnabled) {
        ctx.queue.enqueue(
          'embedding.create',
          { mediaId: asset.id },
          { dedupeKey: `embedding.create:${asset.id}`, priority: 1 },
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
    if (manualReview) {
      bus.emit(
        'media.manual_review',
        { mediaId: asset.id, sourceKey: policy.matchedKey ?? null },
        'bot',
      );
    }

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
