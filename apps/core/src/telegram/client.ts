export interface MessageRef {
  chatId: number;
  messageId: number;
}

export interface ForwardResult {
  chatId: number;
  messageId: number;
}

export type SendMode = 'forward' | 'copy';

/**
 * Telegram 接入的统一抽象：M1 由 BotClient 实现，
 * M2 的 MTProto user client 实现同一接口（扫描历史 / 重建索引 / copy 原消息）。
 */
export interface TelegramClient {
  readonly kind: 'bot' | 'mtproto';
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 把源消息转发/复制到目标会话，返回新消息定位 */
  sendMedia(source: MessageRef, targetChatId: number, mode: SendMode): Promise<ForwardResult>;
  /** 下载 file_id 指向的文件到本地路径（仅用于缩略图等小文件） */
  downloadFile(fileId: string, destPath: string): Promise<void>;
}
