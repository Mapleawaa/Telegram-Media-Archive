import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { Bot } from 'grammy';
import type { Message } from 'grammy/types';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Logger } from 'pino';
import type { InlineKeyboard } from '@tma/shared';
import type { AppConfig } from '../../config.js';
import type { ForwardResult, MessageRef, SendMode, TelegramClient } from '../client.js';
import type { IncomingMessage } from '../types.js';
import { extractIncoming } from './extract.js';
import { gatePromptKeyboard, type GateResult, type GateTarget } from './gate.js';

export interface BotClientDeps {
  config: AppConfig;
  logger: Logger;
  onMessage: (msg: IncomingMessage) => void;
  /**
   * X1-2 私聊命令处理：收到 /开头的私聊文本时调用，返回的文本回复给用户。
   * 可选——未提供时私聊命令被忽略（冒烟/测试环境）。
   */
  onCommand?: (text: string, chatId: number) => Promise<string>;
  /**
   * X2 门控按钮回调：解析 callback_data 并应用决策，返回要编辑进提示消息的内容。
   * 可选——未提供时按钮点击只应答不动作（测试环境）。
   */
  onGateCallback?: (data: string) => GateResult | null;
}

/** Telegram 的 Bot 命令菜单（聊天框左侧菜单按钮） */
const BOT_COMMANDS = [
  { command: 'search', description: '搜索媒体：/search 关键词' },
  { command: 'recent', description: '最近归档 5 条' },
  { command: 'detail', description: '查看单条详情：/detail 媒体ID' },
  { command: 'stats', description: '媒体库统计' },
  { command: 'pending', description: '待人工分类的媒体' },
  { command: 'start', description: '绑定归档通知' },
  { command: 'stop', description: '关闭归档通知' },
  { command: 'help', description: '帮助' },
] as const;

export class BotClient implements TelegramClient {
  readonly kind = 'bot' as const;
  private readonly bot: Bot;
  private readonly agent?: HttpsProxyAgent<string>;
  private runner?: RunnerHandle;
  private readonly logger: Logger;

  constructor(private readonly deps: BotClientDeps) {
    this.logger = deps.logger.child({ mod: 'bot' });
    this.agent = deps.config.TELEGRAM_PROXY_URL
      ? new HttpsProxyAgent(deps.config.TELEGRAM_PROXY_URL)
      : undefined;
    this.bot = new Bot(deps.config.TG_BOT_TOKEN, {
      client: this.agent
        ? { baseFetchConfig: { agent: this.agent } as never }
        : undefined,
    });
    this.bot.on('message', (ctx) => this.handle(ctx.message));
    this.bot.on('channel_post', (ctx) => this.handle(ctx.channelPost));
    // X2：门控按钮回调——应用决策并把提示消息原地编辑成结果
    this.bot.on('callback_query:data', async (ctx) => {
      try {
        const result = this.deps.onGateCallback?.(ctx.callbackQuery.data ?? '') ?? null;
        await ctx.answerCallbackQuery().catch(() => undefined);
        if (result) {
          // 提示消息可能已被用户删除；编辑失败只记日志，不影响决策已落库
          await ctx
            .editMessageText(result.text, {
              reply_markup: (result.keyboard ?? undefined) as never,
            })
            .catch((err) => this.logger.warn({ err }, '门控提示消息编辑失败（决策已生效）'));
        }
      } catch (err) {
        this.logger.error({ err, data: ctx.callbackQuery.data }, '门控按钮处理失败');
        await ctx.answerCallbackQuery({ text: '处理出错，稍后再试' }).catch(() => undefined);
      }
    });
    this.bot.catch((err) => {
      this.logger.error({ err: err.error }, 'Bot 更新处理异常');
    });
  }

  async start(): Promise<void> {
    const me = await this.bot.api.getMe();
    this.logger.info(
      {
        id: me.id,
        username: me.username,
        archiveChatId: this.deps.config.TG_ARCHIVE_CHAT_ID,
        proxy: this.agent ? 'on' : 'off',
      },
      'Bot 已连接，开始长轮询',
    );
    // 命令菜单注册失败不影响归档（例如 token 是无效演示值时）
    await this.bot.api.setMyCommands([...BOT_COMMANDS]).catch((err) => {
      this.logger.warn({ err }, 'Bot 命令菜单注册失败（不影响归档）');
    });
    this.runner = run(this.bot);
  }

  async stop(): Promise<void> {
    await this.runner?.stop();
    this.runner = undefined;
  }

  async sendMedia(source: MessageRef, targetChatId: number, mode: SendMode): Promise<ForwardResult> {
    if (mode === 'forward') {
      const sent = await this.bot.api.forwardMessage(targetChatId, source.chatId, source.messageId);
      return { chatId: targetChatId, messageId: sent.message_id };
    }
    const sent = await this.bot.api.copyMessage(targetChatId, source.chatId, source.messageId);
    return { chatId: targetChatId, messageId: sent.message_id };
  }

  /** 发纯文本消息（X1-1 通知与 X1-2 命令回复共用）。失败只记日志，不抛出。 */
  async sendText(chatId: number, text: string): Promise<void> {
    try {
      // 纯文本发送：不指定 parse_mode，避免标题里的下划线/方括号触发实体解析错误
      await this.bot.api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
    } catch (err) {
      this.logger.error({ err, chatId }, 'Bot 发送文本失败');
    }
  }

  /**
   * X2 门控提问：引用刚归档的消息，问「需要让 AI 审核这个帖子吗？」。
   * 失败只记日志——归档已成功，提问只是交互层。
   */
  async sendGatePrompt(chatId: number, replyToMessageId: number, target: GateTarget): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatId, '需要让 AI 审核这个帖子吗？', {
        reply_parameters: { message_id: replyToMessageId },
        reply_markup: gatePromptKeyboard(target) as never,
      });
    } catch (err) {
      this.logger.warn({ err, chatId, replyToMessageId }, '门控提问发送失败（归档不受影响）');
    }
  }

  async downloadFile(fileId: string, destPath: string): Promise<void> {
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) throw new Error('Telegram 未返回 file_path');

    const url = `https://api.telegram.org/file/bot${this.deps.config.TG_BOT_TOKEN}/${file.file_path}`;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      https
        .get(url, { agent: this.agent }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`下载文件失败: HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        })
        .on('error', reject);
    });

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer);
  }

  private handle(msg: Message): void {
    // X1-2：私聊命令不走归档过滤——用户 /search /stats 等，直接应答
    if (msg.chat.type === 'private' && typeof msg.text === 'string' && msg.text.startsWith('/')) {
      void this.handleCommand(msg.text, msg.chat.id);
      return;
    }
    if (msg.chat.id !== this.deps.config.TG_ARCHIVE_CHAT_ID) {
      this.logger.debug({ chatId: msg.chat.id, messageId: msg.message_id }, '忽略非归档群消息');
      return;
    }
    const incoming = extractIncoming(msg);
    if (!incoming) return;
    try {
      this.deps.onMessage(incoming);
    } catch (err) {
      this.logger.error({ err, messageId: msg.message_id }, '归档入库失败');
    }
  }

  private async handleCommand(text: string, chatId: number): Promise<void> {
    if (!this.deps.onCommand) return;
    try {
      const reply = await this.deps.onCommand(text, chatId);
      await this.sendText(chatId, reply);
    } catch (err) {
      this.logger.error({ err, chatId, text }, '私聊命令处理失败');
      await this.sendText(chatId, '命令处理出错了，稍后再试或用 /help 查看可用命令。');
    }
  }
}
