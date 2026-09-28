import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  mediaAnnotation,
  mediaAsset,
  mediaMetadata,
  mediaTag,
  telegramMessage,
} from '../database/schema.js';
import { rebuildSearchDoc } from '../metadata/rebuild-search-doc.js';
import type { ensureThumbnail as EnsureThumbnailFn } from '../telegram/bot/thumbnail.js';
import type { TelegramClient } from '../telegram/client.js';
import type { AiGateway } from './gateway.js';

export interface TextEnrichment {
  title?: string;
  summary?: string;
  tags?: string[];
  category?: string;
}

export interface VisionEnrichment {
  description?: string;
  themes?: string[];
  mood?: string[];
}

type AiStatus = 'pending' | 'partial' | 'done' | 'failed' | 'skipped';

const MAX_COMMENT = 1;
export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 退一步：抓取第一个 JSON 对象
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildTextPrompt(input: {
  fileName: string | null;
  type: string;
  mime: string | null;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  quality: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  caption: string | null;
  chatTitle: string | null;
  userTags: string[];
  annotations: string[];
}): string {
  const lines = [
    '你是媒体归档助手。根据下列信息为这条媒体生成结构化元数据。',
    '只输出 JSON 对象，不要任何解释，字段：',
    '{"title": 规范标题(尽量短, 无把握时给空字符串), "summary": 一到两句中文摘要, "tags": [3-8 个中文或英文标签], "category": "video|photo|audio|animation|document 之一"}',
    '',
    `文件名: ${input.fileName ?? '(无)'}`,
    `类型: ${input.type}${input.mime ? ` (${input.mime})` : ''}`,
    `大小: ${Math.round(input.sizeBytes / 1024 / 1024)} MB`,
  ];
  if (input.durationSec) {
    const m = Math.floor(input.durationSec / 60);
    lines.push(`时长: ${m} 分 ${input.durationSec % 60} 秒`);
  }
  if (input.width && input.height) lines.push(`分辨率: ${input.width}x${input.height}`);
  if (input.quality) lines.push(`画质标记: ${input.quality}`);
  if (input.year) lines.push(`年份: ${input.year}`);
  if (input.season != null) lines.push(`季集: S${input.season}E${input.episode ?? '?'}`);
  if (input.caption) lines.push(`转发附言: ${input.caption}`);
  if (input.chatTitle) lines.push(`来源群: ${input.chatTitle}`);
  if (input.userTags.length > 0) lines.push(`已有标签: ${input.userTags.join(', ')}`);
  if (input.annotations.length > 0) {
    lines.push(`用户注解: ${input.annotations.slice(0, MAX_COMMENT).join(' | ')}`);
  }
  return lines.join('\n');
}

export function buildVisionPrompt(): string {
  return [
    '这是一条媒体（视频或图片）的缩略图。',
    '只输出 JSON 对象，字段：',
    '{"description": 一句话中文画面描述, "themes": [主题标签数组], "mood": [氛围词数组]}',
  ].join('\n');
}

export interface EnrichOutcome {
  status: AiStatus;
  textEnrichment: TextEnrichment | null;
  visionEnrichment: VisionEnrichment | null;
  errors: string[];
}

export async function enrichMedia(
  ctx: AppContext,
  gateway: AiGateway,
  client: TelegramClient,
  assetId: number,
  ensureThumbnailFn: typeof EnsureThumbnailFn,
): Promise<EnrichOutcome> {
  const { db } = ctx;
  const asset = db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  if (!asset) return { status: 'skipped', textEnrichment: null, visionEnrichment: null, errors: ['媒体不存在'] };

  const meta = db
    .select()
    .from(mediaMetadata)
    .where(eq(mediaMetadata.mediaAssetId, assetId))
    .get();
  const primary = asset.preferredMessageId
    ? db.select().from(telegramMessage).where(eq(telegramMessage.id, asset.preferredMessageId)).get()
    : undefined;
  const tags = db
    .select()
    .from(mediaTag)
    .where(eq(mediaTag.mediaAssetId, assetId))
    .all();
  const annotations = db
    .select()
    .from(mediaAnnotation)
    .where(eq(mediaAnnotation.mediaAssetId, assetId))
    .all();

  const caps = gateway.capabilities();
  const errors: string[] = [];
  let textEnrichment: TextEnrichment | null = null;
  let visionEnrichment: VisionEnrichment | null = null;
  let chatOk = false;
  let visionOk = false;
  let thumbPath: string | null = null;

  if (caps.vision) {
    thumbPath = await ensureThumbnailFn(ctx, client, assetId);
  }
  const expectVision = caps.vision && thumbPath !== null;
  const expectChat = caps.chat;

  if (!expectChat && !expectVision) {
    db.update(mediaAsset)
      .set({ aiStatus: 'skipped', updatedAt: new Date() })
      .where(eq(mediaAsset.id, assetId))
      .run();
    return { status: 'skipped', textEnrichment, visionEnrichment, errors };
  }

  let outcomeStatus: AiStatus = 'skipped';

  try {
    await gateway.withRun('enrich', `富化媒体 #${assetId}`, async (runId) => {
      if (expectChat) {
      const prompt = buildTextPrompt({
        fileName: meta?.fileName ?? null,
        type: asset.type,
        mime: asset.mime,
        sizeBytes: asset.size,
        durationSec: asset.durationSec,
        width: asset.width,
        height: asset.height,
        quality: meta?.quality ?? null,
        year: meta?.year ?? null,
        season: meta?.season ?? null,
        episode: meta?.episode ?? null,
        caption: primary?.caption ?? null,
        chatTitle: primary?.chatTitle ?? null,
        userTags: tags.map((t) => t.tag),
        annotations: annotations.map((a) => a.rawText),
      });
      try {
        const response = await gateway.runChat(
          {
            messages: [
              { role: 'system', content: '你是严谨的媒体元数据助手，只输出 JSON。' },
              { role: 'user', content: prompt },
            ],
            jsonMode: true,
            temperature: 0.2,
            maxTokens: 800,
          },
          { runId, label: 'enrich.text' },
        );
        const parsed = parseJsonLoose<TextEnrichment>(response.text);
        if (parsed) {
          textEnrichment = {
            title: typeof parsed.title === 'string' ? parsed.title.trim() : undefined,
            summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined,
            tags: Array.isArray(parsed.tags)
              ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 12)
              : undefined,
            category: typeof parsed.category === 'string' ? parsed.category : undefined,
          };
          chatOk = true;
        } else {
          errors.push('文本富化返回无法解析为 JSON');
        }
      } catch (err) {
        errors.push(`文本富化失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (expectVision && thumbPath) {
      try {
        const response = await gateway.runVision(
          {
            prompt: buildVisionPrompt(),
            images: [{ type: 'image', image: { kind: 'path', path: thumbPath } }],
            jsonMode: true,
            temperature: 0.3,
            maxTokens: 2_048,
          },
          { runId, label: 'enrich.vision' },
        );
        const parsed = parseJsonLoose<VisionEnrichment>(response.text);
        if (parsed) {
          visionEnrichment = {
            description:
              typeof parsed.description === 'string' ? parsed.description.trim() : undefined,
            themes: Array.isArray(parsed.themes)
              ? parsed.themes.filter((t): t is string => typeof t === 'string').slice(0, 8)
              : undefined,
            mood: Array.isArray(parsed.mood)
              ? parsed.mood.filter((t): t is string => typeof t === 'string').slice(0, 6)
              : undefined,
          };
          visionOk = true;
        } else {
          errors.push('视觉富化返回无法解析为 JSON');
        }
      } catch (err) {
        errors.push(`视觉富化失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const expected = (expectChat ? 1 : 0) + (expectVision ? 1 : 0);
    const succeeded = (chatOk ? 1 : 0) + (visionOk ? 1 : 0);
    outcomeStatus = succeeded === 0 ? 'failed' : succeeded === expected ? 'done' : 'partial';
    if (outcomeStatus === 'failed') {
      throw new Error(errors.join('；') || 'AI 富化失败');
    }
  });
  } catch (err) {
    // run 已记录为 failed；这里把媒体状态也落成 failed，异常继续上抛交给队列重试
    applyEnrichment(ctx, assetId, { textEnrichment, visionEnrichment, status: 'failed' });
    throw err;
  }

  applyEnrichment(ctx, assetId, { textEnrichment, visionEnrichment, status: outcomeStatus });
  return { status: outcomeStatus, textEnrichment, visionEnrichment, errors };
}

function applyEnrichment(
  ctx: AppContext,
  assetId: number,
  input: {
    textEnrichment: TextEnrichment | null;
    visionEnrichment: VisionEnrichment | null;
    status: AiStatus;
  },
): void {
  const { db, bus } = ctx;
  const asset = db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  const meta = db
    .select()
    .from(mediaMetadata)
    .where(eq(mediaMetadata.mediaAssetId, assetId))
    .get();
  if (!asset) return;

  const { textEnrichment, visionEnrichment, status } = input;
  const summaryParts = [textEnrichment?.summary, visionEnrichment?.description].filter(
    (v): v is string => Boolean(v),
  );

  // 规则标题优先；只有在没有规则标题时才采用 AI 标题
  if (textEnrichment?.title && !meta?.titleNorm) {
    db.update(mediaAsset)
      .set({ canonicalTitle: textEnrichment.title, updatedAt: new Date() })
      .where(eq(mediaAsset.id, assetId))
      .run();
  }

  const extractedBy =
    textEnrichment && visionEnrichment
      ? 'mixed'
      : textEnrichment
        ? 'llm'
        : visionEnrichment
          ? 'vision'
          : (meta?.extractedBy ?? null);

  db.update(mediaMetadata)
    .set({
      summary: summaryParts.length > 0 ? summaryParts.join('\n') : (meta?.summary ?? null),
      extractedBy,
      updatedAt: new Date(),
    })
    .where(eq(mediaMetadata.mediaAssetId, assetId))
    .run();

  const addTags = (list: string[] | undefined, source: 'llm' | 'vision') => {
    for (const tag of list ?? []) {
      const clean = tag.trim().slice(0, 64);
      if (!clean) continue;
      db.insert(mediaTag)
        .values({ mediaAssetId: assetId, tag: clean, source })
        .onConflictDoNothing()
        .run();
    }
  };
  addTags(textEnrichment?.tags, 'llm');
  addTags(visionEnrichment?.themes, 'vision');
  addTags(visionEnrichment?.mood, 'vision');

  db.update(mediaAsset)
    .set({ aiStatus: status, updatedAt: new Date() })
    .where(eq(mediaAsset.id, assetId))
    .run();

  rebuildSearchDoc(ctx, assetId);
  bus.emit('media.analyzed', { mediaId: assetId, status }, 'agent');
}
