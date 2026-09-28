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
}
