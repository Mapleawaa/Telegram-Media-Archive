import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../database/test-utils.js';
import { ingestMessage } from '../../ingestion/ingest.js';
import { AiGateway } from '../../ai/gateway.js';
import type { IncomingMessage } from '../../telegram/types.js';
import {
  COMMAND_LIST,
  HELP_TEXT,
  formatListItem,
  handleBotCommand,
  readNotifyChatId,
} from './commands.js';

function makeCtx() {
  const ctx = createTestContext();
  const ai = new AiGateway(ctx.db, ctx.logger, ctx.config);
  return { ctx, ai };
}

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    chatId: -100123,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageId: Math.floor(Math.random() * 1_000_000) + 1,
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: `f-${Math.random()}`,
      fileUniqueId: `u-${Math.random()}`,
      fileName: 'Show.S01E01.1080p.mkv',
      size: 1_500_000_000,
      durationSec: 1800,
      width: 1920,
      height: 1080,
    },
    ...overrides,
  };
}

describe('通知绑定', () => {
  it('未绑定时 readNotifyChatId 为 0（静默）', () => {
    const { ctx } = makeCtx();
    expect(readNotifyChatId(ctx)).toBe(0);
  });
});

describe('handleBotCommand', () => {
  it('/start 绑定通知 chat id，/stop 解绑', async () => {
    const { ctx, ai } = makeCtx();
    const deps = { ctx, ai };

    const startReply = await handleBotCommand(deps, '/start', 777);
    expect(startReply).toContain('已绑定');
    expect(readNotifyChatId(ctx)).toBe(777);

    const stopReply = await handleBotCommand(deps, '/stop', 777);
    expect(stopReply).toContain('已关闭');
    expect(readNotifyChatId(ctx)).toBe(0);
  });

  it('/help 列出全部命令', async () => {
    const { ctx, ai } = makeCtx();
    const reply = await handleBotCommand({ ctx, ai }, '/help');
    for (const line of COMMAND_LIST) {
      expect(reply).toContain(line.split(' — ')[0]!);
    }
    expect(reply).toBe(HELP_TEXT);
  });

  it('/stats 统计入库后的分类分布', async () => {
    const { ctx, ai } = makeCtx();
    ingestMessage(ctx, makeMsg()); // video → other
    ingestMessage(
      ctx,
      makeMsg({ media: { kind: 'photo', fileId: 'p1', fileUniqueId: 'up1', width: 100, height: 150 } }),
    ); // photo → gallery
    const reply = await handleBotCommand({ ctx, ai }, '/stats');
    expect(reply).toContain('总计 2 条');
    expect(reply).toContain('图集 1');
    expect(reply).toContain('没有待人工分类');
  });

  it('/search 命中标题关键词', async () => {
    const { ctx, ai } = makeCtx();
    ingestMessage(ctx, makeMsg({ media: { ...makeMsg().media, fileName: 'Inception.2010.mkv' } }));
    const reply = await handleBotCommand({ ctx, ai }, '/search inception');
    expect(reply).toContain('Inception');
  });

  it('/search 无参数给用法提示；搜不到给明确反馈', async () => {
    const { ctx, ai } = makeCtx();
    expect(await handleBotCommand({ ctx, ai }, '/search')).toContain('用法');
    expect(await handleBotCommand({ ctx, ai }, '/search 不存在的词xyz')).toContain('没有找到');
  });

  it('/recent 列出最近归档并带序号与标签行', async () => {
    const { ctx, ai } = makeCtx();
    ingestMessage(ctx, makeMsg());
    const reply = await handleBotCommand({ ctx, ai }, '/recent');
    expect(reply).toContain('最近归档');
    expect(reply).toMatch(/1\. 《.+》 #\d+/);
  });

  it('/detail 展示单条详情；/detail 999 提示不存在', async () => {
    const { ctx, ai } = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    const reply = await handleBotCommand({ ctx, ai }, `/detail ${assetId}`);
    expect(reply).toContain(`#${assetId}`);
    expect(reply).toContain('来源');
    expect(reply).toContain('AI 状态');

    expect(await handleBotCommand({ ctx, ai }, '/detail 999')).toContain('没有找到');
    expect(await handleBotCommand({ ctx, ai }, '/detail')).toContain('用法');
  });

  it('/pending：被拉黑的来源进人工队列后可查', async () => {
    const { ctx, ai } = makeCtx();
    // 无 forward origin 的消息不走黑名单——直接用分类动作模拟 manual 状态
    const { assetId } = ingestMessage(ctx, makeMsg());
    ctx.sqlite
      .prepare(`UPDATE media_asset SET ai_status = 'manual', ai_skip = 1 WHERE id = ?`)
      .run(assetId);
    const reply = await handleBotCommand({ ctx, ai }, '/pending');
    expect(reply).toContain('待人工分类');
    expect(reply).toContain(`#${assetId}`);
  });

  it('未知命令给引导；非命令文本回帮助', async () => {
    const { ctx, ai } = makeCtx();
    expect(await handleBotCommand({ ctx, ai }, '/foobar')).toContain('未知命令 /foobar');
    expect(await handleBotCommand({ ctx, ai }, '在吗？')).toBe(HELP_TEXT);
  });
});

describe('formatListItem', () => {
  it('带分类、大小、时长与 AI 标记', () => {
    const line = formatListItem(
      {
        id: 12,
        title: '某视频',
        type: 'video',
        mime: null,
        sizeBytes: 57_100_000_000,
        durationSec: 9780,
        width: null,
        height: null,
        quality: '1080p',
        year: null,
        aiStatus: 'manual',
        sourceCount: 1,
        tags: ['电影', '科幻'],
        hasThumbnail: true,
        createdAt: 0,
        aiSkip: false,
        category: 'movie',
        categorySource: 'user',
        titleSource: null,
        isSensitive: false,
        mediaGroupId: null,
        albumCount: 1,
      },
      0,
    );
    expect(line).toContain('《某视频》 #12');
    expect(line).toContain('电影 · 53.2 GB · 2:43:00');
    expect(line).toContain('⏸待人工');
    expect(line).toContain('标签：电影、科幻');
  });
});
