export interface IncomingMedia {
  kind: 'video' | 'photo' | 'audio' | 'animation' | 'document' | 'other';
  fileId: string;
  fileUniqueId: string;
  fileName?: string;
  mime?: string;
  size?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  thumbnailFileId?: string;
}

/** Telegram 转发来源的四种形态（Bot API `forward_origin` 的 type 取值） */
export type ForwardOriginType = 'user' | 'hidden_user' | 'chat' | 'channel';

/**
 * 归一化后的转发来源。
 *
 * 注意 Telegram 的语义坑：**「转发自某个群/频道」与「转发自某个人的消息」**
 * 是两种不同形态——同一份内容经不同人转发，`originType` 可能是 `user`（那个人）
 * 而不是 `chat`（原群）。因此来源策略必须支持多类型 key，另有单条手动开关兜底。
 */
export interface ForwardOrigin {
  originType: ForwardOriginType;
  /** chat / channel：来源会话 ID */
  chatId?: number;
  /** chat / channel：来源会话标题 */
  chatTitle?: string;
  /** chat / channel：来源会话公开用户名（无 @） */
  chatUsername?: string;
  /** user：原发送者用户 ID */
  senderUserId?: number;
  /** user / hidden_user：原发送者名称（hidden_user 仅有名称） */
  senderName?: string;
}

export interface IncomingMessage {
  chatId: number;
  messageId: number;
  chatType?: string;
  chatTitle?: string;
  mediaGroupId?: string;
  senderId?: number;
  senderName?: string;
  caption?: string;
  captionEntities?: unknown;
  messageDate: number;
  media: IncomingMedia;
  /** 转发来源；非转发消息为 undefined */
  forward?: ForwardOrigin;
}
