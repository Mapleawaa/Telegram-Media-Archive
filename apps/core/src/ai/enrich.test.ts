import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '@tma/shared';
import { setSetting } from '../settings/store.js';
import type { AIProvider } from './types.js';
import { createTestContext } from '../database/test-utils.js';
import { mediaAsset, mediaMetadata, mediaTag } from '../database/schema.js';
import { ingestMessage } from '../ingestion/ingest.js';
import { ensureThumbnail } from '../telegram/bot/thumbnail.js';
import type { TelegramClient } from '../telegram/client.js';
import type { IncomingMessage } from '../telegram/types.js';
import { enrichMedia, looksLikeRefusal, parseJsonLoose } from './enrich.js';

function makeClient(): TelegramClient {
  return {
    kind: 'bot',
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    sendMedia: () => Promise.resolve({ chatId: 1, messageId: 1 }),
    downloadFile: (fileId: string, destPath: string) => {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // 伪 JPEG
      return Promise.resolve();
    },
  };
}

function makeMsg(): IncomingMessage {
  return {
    chatId: -1002464626889,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    caption: '#测试 附言内容',
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: 'f1',
      fileUniqueId: 'u1',
      fileName: 'Breaking.Bad.S05E10.2160p.WEB-DL.H.265.mkv',
      mime: 'video/x-matroska',
      size: 1_000_000,
      durationSec: 2700,
      width: 3840,
      height: 2160,
      thumbnailFileId: 't1',
    },
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tma-ai-test-'));
  return createTestContext({ dataDir, ...overrides } as never);
}

describe('parseJsonLoose / looksLikeRefusal', () => {
  it('正常 JSON 与代码围栏', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('截断的 JSON（推理模型 max_tokens 耗尽）能修补出可用字段', () => {
    const truncated = '{"description":"一个动漫角色躺在床上","themes":["二次元","人物"],"mood":["暧昧"';
    const parsed = parseJsonLoose<{ description?: string; themes?: string[] }>(truncated);
    expect(parsed?.description).toBe('一个动漫角色躺在床上');
    expect(parsed?.themes).toEqual(['二次元', '人物']);
  });

  it('带前后杂文的 JSON 能抓取对象', () => {
    const parsed = parseJsonLoose<{ a: number }>('好的，这是结果：{"a":1} 以上。');
    expect(parsed).toEqual({ a: 1 });
  });

  it('拒答文本被识别（且不误伤正常 JSON）', () => {
    expect(looksLikeRefusal('抱歉，我无法按照要求描述这张图片。')).toBe(true);
    expect(looksLikeRefusal('I cannot help with that request.')).toBe(true);
    expect(looksLikeRefusal('{"description":"一位少女"}')).toBe(false);
    expect(looksLikeRefusal('从图文内容来看，用户发来的图片涉及不当画面，我无法描述。')).toBe(true);
  });
});

describe('enrichMedia', () => {
  it('AI 未启用：归档后 ai_status=skipped 且不入队', () => {
    const ctx = makeCtx();
    const result = ingestMessage(ctx, makeMsg());
    const asset = ctx.db.select().from(mediaAsset).all();
    expect(asset[0]!.aiStatus).toBe('skipped');
    expect(result.assetCreated).toBe(true);
    const jobs = ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number };
    expect(jobs.n).toBe(0);
  });

  it('AI 启用（auto 门控）：归档时入队 ai.enrich 且跑完 mock 文本+视觉富化', async () => {
    const ctx = makeCtx({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat', AI_VLM_MODEL: 'mock/vision' });
    setSetting(ctx, SETTING_KEYS.ingestGateMode, 'auto');
    const ingested = ingestMessage(ctx, makeMsg());
    expect(ctx.ai.enrichEnabled).toBe(true);

    const queued = ctx.sqlite
      .prepare(`SELECT type, status FROM jobs WHERE type = 'ai.enrich'`)
      .get() as { type: string; status: string } | undefined;
    expect(queued?.type).toBe('ai.enrich');

    const outcome = await enrichMedia(ctx, ctx.ai, makeClient(), ingested.assetId, ensureThumbnail);
    expect(outcome.status).toBe('done');

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiStatus).toBe('done');

    const meta = ctx.db.select().from(mediaMetadata).all()[0]!;
    expect(meta.summary).toContain('[mock]');
    expect(meta.extractedBy).toBe('mixed');

    // 规则标题（Breaking Bad）优先，AI 标题不覆盖
    expect(asset.canonicalTitle).toBe('Breaking Bad');

    const tags = ctx.db.select().from(mediaTag).all();
    const llmTags = tags.filter((t) => t.source === 'llm').map((t) => t.tag);
    const visionTags = tags.filter((t) => t.source === 'vision').map((t) => t.tag);
    expect(llmTags).toContain('mock标签');
    expect(visionTags).toContain('mock主题');

    // ai_runs / ai_steps 记账
    const runs = ctx.sqlite.prepare(`SELECT kind, status FROM ai_runs`).all() as {
      kind: string;
      status: string;
    }[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ kind: 'enrich', status: 'succeeded' });

    const steps = ctx.sqlite
      .prepare(`SELECT tool_name AS toolName, status, latency_ms AS latencyMs FROM ai_steps ORDER BY step_index`)
      .all() as { toolName: string; status: string; latencyMs: number }[];
    expect(steps.map((s) => s.toolName)).toEqual(['enrich.text', 'enrich.vision']);
    expect(steps.every((s) => s.status === 'succeeded' && s.latencyMs >= 0)).toBe(true);

    // 审计事件
    const audits = ctx.sqlite
      .prepare(`SELECT event FROM audit_events WHERE event = 'media.analyzed'`)
      .all();
    expect(audits).toHaveLength(1);
  });

  it('视觉模型未配置：只做文本富化，状态 done', async () => {
    const ctx = makeCtx({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat' });
    const ingested = ingestMessage(ctx, makeMsg());
    const outcome = await enrichMedia(ctx, ctx.ai, makeClient(), ingested.assetId, ensureThumbnail);
    expect(outcome.status).toBe('done');
    const meta = ctx.db.select().from(mediaMetadata).all()[0]!;
    expect(meta.extractedBy).toBe('llm');
  });

  it('视觉返回非 JSON（内容审核拒答）：不计为失败，状态 done 并留下可读步骤', async () => {
    const ctx = makeCtx({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat', AI_VLM_MODEL: 'mock/vision' });
    const ingested = ingestMessage(ctx, makeMsg());

    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const stub: AIProvider = {
      id: 'stub',
      chat: () =>
        Promise.resolve({
          text: '{"title":"T","summary":"S","tags":["a"]}',
          toolCalls: [],
          finishReason: 'stop',
          usage,
          model: 'stub',
          latencyMs: 1,
        }),
      vision: () =>
        Promise.resolve({
          text: '从图文内容来看，用户发来的图片涉及不当画面，我无法按要求描述。',
          toolCalls: [],
          finishReason: 'stop',
          usage,
          model: 'stub',
          latencyMs: 1,
        }),
      embed: () => Promise.reject(new Error('unused')),
    };
    Object.assign(ctx.ai.runtimes.chat, { provider: stub, enabled: true });
    Object.assign(ctx.ai.runtimes.vision, { provider: stub, enabled: true });

    const outcome = await enrichMedia(ctx, ctx.ai, makeClient(), ingested.assetId, ensureThumbnail);
    expect(outcome.status).toBe('done');

    const steps = ctx.sqlite
      .prepare(`SELECT tool_name AS toolName, status FROM ai_steps ORDER BY step_index`)
      .all() as { toolName: string; status: string }[];
    expect(steps.map((s) => s.toolName)).toContain('vision.unusable');

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiStatus).toBe('done');
  });

  it('provider 故障：ai_status=failed 且抛出（交给队列重试），归档数据不受影响', async () => {
    const ctx = makeCtx({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat' });
    const ingested = ingestMessage(ctx, makeMsg());

    const failing: AIProvider = {
      id: 'failing',
      chat: () => Promise.reject(new Error('模拟上游故障')),
      vision: () => Promise.reject(new Error('模拟上游故障')),
      embed: () => Promise.reject(new Error('模拟上游故障')),
    };
    Object.assign(ctx.ai.runtimes.chat, { provider: failing, enabled: true });
    Object.assign(ctx.ai.runtimes.vision, { provider: failing, enabled: true });

    await expect(
      enrichMedia(ctx, ctx.ai, makeClient(), ingested.assetId, ensureThumbnail),
    ).rejects.toThrow('模拟上游故障');

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiStatus).toBe('failed');

    const run = ctx.sqlite.prepare(`SELECT status, error FROM ai_runs`).get() as {
      status: string;
      error: string;
    };
    expect(run.status).toBe('failed');
    expect(run.error).toContain('模拟上游故障');

    // 归档本体完好
    expect(ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM telegram_message`).get()).toEqual({ n: 1 });
  });
});
