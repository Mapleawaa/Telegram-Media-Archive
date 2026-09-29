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
import { applyDerivedCategory } from '../metadata/category.js';
import { filterTags, pruneAssetTags } from '../metadata/tag-policy.js';
import {
  deriveTitleFromDescription,
  isBadAiTitleLike,
  isJunkTitle,
  sanitizeAiTitle,
} from '../metadata/title-policy.js';
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

type AiStatus = 'pending' | 'partial' | 'done' | 'failed' | 'skipped' | 'manual';

const MAX_COMMENT = 1;

function stripCodeFence(text: string): string {
  return text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/** 推理型模型可能在 JSON 中途被 max_tokens 截断：扫描状态修补未闭合的字符串/括号 */
function repairTruncatedJson(text: string): string {
  let inString = false;
  let escaped = false;
  let lastStringStart = -1;
  let curly = 0;
  let square = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      if (inString) lastStringStart = i;
      continue;
    }
    if (inString) continue;
    if (ch === '{') curly += 1;
    else if (ch === '}') curly -= 1;
    else if (ch === '[') square += 1;
    else if (ch === ']') square -= 1;
  }

  let out = text;
  if (inString && lastStringStart >= 0) out = `${out.slice(0, lastStringStart)}"`;
  out = out.replace(/[,:\s]+$/, '');
  out += ']'.repeat(Math.max(0, square));
  out += '}'.repeat(Math.max(0, curly));
  return out;
}

export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 继续尝试修复
  }

  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const candidate = cleaned.slice(start);

  const end = candidate.lastIndexOf('}');
  if (end > 0) {
    try {
      return JSON.parse(candidate.slice(0, end + 1)) as T;
    } catch {
      // 继续尝试修补
    }
  }

  const repaired = repairTruncatedJson(candidate);
  try {
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}

/** 内容审核拒答识别：没有 JSON 结构且带拒绝语气的文本 */
export function looksLikeRefusal(text: string): boolean {
  if (text.includes('{')) return false;
  return /(无法|不能|抱歉|拒绝|不合规|超出|不便|cannot|can'?t|sorry|unable)/i.test(text);
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
    '{"title": 规范标题(尽量短, 无把握时给空字符串), "summary": 一到两句中文摘要, "tags": [3-8 个中文或英文标签], "category": "归档分类, 取 movie|series|anime|adult|gallery|other 之一(无法判断给 other)"}',
    '',
    '分类口径：movie=电影长片；series=电视剧/连续剧；anime=动漫/番剧；adult=成人内容；gallery=图片/写真/图集；other=其余或无法判断。',
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
    '这是一条媒体（视频或图片）的缩略图，用于个人媒体库归档索引。',
    '只输出 JSON 对象，字段保持简短（description 一句话、每项标签不超过 10 个字，总输出不超过 200 字）：',
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

  const caps = { chat: gateway.chatEnabled, vision: gateway.visionEnabled };
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

    let visionUnusable = false;
    if (expectVision && thumbPath) {
      try {
        const response = await gateway.runVision(
          {
            prompt: buildVisionPrompt(),
            images: [{ type: 'image', image: { kind: 'path', path: thumbPath } }],
            jsonMode: true,
            temperature: 0.3,
            maxTokens: 4_096,
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
        } else if (!response.text.includes('{')) {
          // 完全没有 JSON 结构：多为内容审核拒答或说明性文字，不计为失败（不触发重试）
          visionUnusable = true;
          gateway.recordStep(runId, {
            type: 'decision',
            toolName: 'vision.unusable',
            output: {
              note: looksLikeRefusal(response.text || response.reasoning || '')
                ? '视觉模型基于内容审核拒答（未返回 JSON），已跳过；可换用其他视觉模型'
                : '视觉模型未按 JSON 格式返回，已跳过',
              excerpt: (response.text || '').slice(0, 200),
            },
            status: 'succeeded',
          });
        } else {
          errors.push('视觉富化返回无法解析为 JSON');
        }
      } catch (err) {
        errors.push(`视觉富化失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const expectCount = (expectChat ? 1 : 0) + (expectVision && !visionUnusable ? 1 : 0);
    const succeededCount = (chatOk ? 1 : 0) + (visionOk ? 1 : 0);
    outcomeStatus =
      succeededCount === 0
        ? expectCount === 0
          ? 'skipped'
          : 'failed'
        : succeededCount === expectCount
          ? 'done'
          : 'partial';
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

  // 富化完成后接力向量化（若配置了 embedding 能力）
  if (ctx.ai.embedEnabled) {
    ctx.queue.enqueue(
      'embedding.create',
      { mediaId: assetId },
      { dedupeKey: `embedding.create:${assetId}`, priority: 1 },
    );
  }

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

  // 标题策略：规则标题优先，但规则标题是「垃圾标题」（通用词/纯数字/内部 ID）或缺失时，
  // 允许 AI 标题补位；AI 未给标题时用视觉描述首句兜底（照片类常见）。
  const aiTitle =
    sanitizeAiTitle(textEnrichment?.title) ?? deriveTitleFromDescription(visionEnrichment?.description);
  const ruleTitle = meta?.titleNorm ?? null;

  // P5-1：用户手动改过标题（title_source='user'）→ 规则与 AI 一律不得覆盖；
  // 这是「人工决定优先」原则在标题上的体现（与分类的 category_source='user' 同理）。
  const titleLocked = asset.titleSource === 'user';
  if (!titleLocked && aiTitle && (isJunkTitle(ruleTitle) || isJunkTitle(asset.canonicalTitle))) {
    db.update(mediaAsset)
      .set({ canonicalTitle: aiTitle, updatedAt: new Date() })
      .where(eq(mediaAsset.id, assetId))
      .run();
  } else if (
    !titleLocked &&
    !aiTitle &&
    isJunkTitle(ruleTitle) &&
    isBadAiTitleLike(asset.canonicalTitle)
  ) {
    // 历史坏标题（如拒答句）且本次没有更好的标题 → 清空，让 UI 用文件名/占位兜底
    db.update(mediaAsset)
      .set({ canonicalTitle: null, updatedAt: new Date() })
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
    for (const clean of filterTags(list ?? [], new Set())) {
      db.insert(mediaTag)
        .values({ mediaAssetId: assetId, tag: clean, source })
        .onConflictDoNothing()
        .run();
    }
  };
  addTags(textEnrichment?.tags, 'llm');
  addTags(visionEnrichment?.themes, 'vision');
  addTags(visionEnrichment?.mood, 'vision');
  // 低价值过滤 / 多来源去重 / 上限截断（含来源群名）
  pruneAssetTags(ctx, assetId);

  // P3-1 分类落库：AI 给出的 category（source='llm'）优先，无 AI 判断时回落确定性规则
  // （season→series / photo→gallery / 成人标签→adult+敏感）。用户已接管的（'user'）不动。
  applyDerivedCategory(ctx, assetId, textEnrichment?.category ?? null);

  // AI 真的跑出结果时，清掉「跳过 AI」标记（语义：ai_skip=1 ⇔ 当前被排除在 AI 之外）
  db.update(mediaAsset)
    .set({
      aiStatus: status,
      aiSkip: status === 'done' || status === 'partial' ? false : asset.aiSkip,
      updatedAt: new Date(),
    })
    .where(eq(mediaAsset.id, assetId))
    .run();

  rebuildSearchDoc(ctx, assetId);
  bus.emit('media.analyzed', { mediaId: assetId, status }, 'agent');
}
