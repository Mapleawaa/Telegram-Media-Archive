import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { Bot } from 'grammy';
import type { Message } from 'grammy/types';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config.js';
import type { ForwardResult, MessageRef, SendMode, TelegramClient } from '../client.js';
import type { IncomingMessage } from '../types.js';
import { extractIncoming } from './extract.js';

export interface BotClientDeps {
  config: AppConfig;
  logger: Logger;
  onMessage: (msg: IncomingMessage) => void;
}

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
}
