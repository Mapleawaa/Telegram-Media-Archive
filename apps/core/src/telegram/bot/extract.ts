import type { Message } from 'grammy/types';
import type { IncomingMedia, IncomingMessage } from '../types.js';

const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

function thumbId(thumb?: { file_id: string }): string | undefined {
  return thumb?.file_id;
}

function pickPhotoPreview(sizes: readonly { file_id: string; file_size?: number }[]): string | undefined {
  if (sizes.length === 0) return undefined;
  for (let i = sizes.length - 1; i >= 0; i -= 1) {
    const candidate = sizes[i];
    if (candidate && (candidate.file_size ?? 0) <= PREVIEW_MAX_BYTES) return candidate.file_id;
  }
  return sizes[0]?.file_id;
}

export function extractMedia(msg: Message): IncomingMedia | null {
  if (msg.video) {
    return {
      kind: 'video',
      fileId: msg.video.file_id,
      fileUniqueId: msg.video.file_unique_id,
      fileName: msg.video.file_name,
      mime: msg.video.mime_type,
      size: msg.video.file_size,
      durationSec: msg.video.duration,
      width: msg.video.width,
      height: msg.video.height,
      thumbnailFileId: thumbId(msg.video.thumbnail),
    };
  }
  if (msg.animation) {
    return {
      kind: 'animation',
      fileId: msg.animation.file_id,
      fileUniqueId: msg.animation.file_unique_id,
      fileName: msg.animation.file_name,
      mime: msg.animation.mime_type,
      size: msg.animation.file_size,
      durationSec: msg.animation.duration,
      width: msg.animation.width,
      height: msg.animation.height,
      thumbnailFileId: thumbId(msg.animation.thumbnail),
    };
  }
  if (msg.audio) {
    return {
      kind: 'audio',
      fileId: msg.audio.file_id,
      fileUniqueId: msg.audio.file_unique_id,
      fileName: msg.audio.file_name,
      mime: msg.audio.mime_type,
      size: msg.audio.file_size,
      durationSec: msg.audio.duration,
      thumbnailFileId: thumbId(msg.audio.thumbnail),
    };
  }
  if (msg.document) {
    return {
      kind: 'document',
      fileId: msg.document.file_id,
      fileUniqueId: msg.document.file_unique_id,
      fileName: msg.document.file_name,
      mime: msg.document.mime_type,
      size: msg.document.file_size,
      thumbnailFileId: thumbId(msg.document.thumbnail),
    };
  }
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1]!;
    return {
      kind: 'photo',
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      width: largest.width,
      height: largest.height,
      size: largest.file_size,
      thumbnailFileId: pickPhotoPreview(msg.photo),
    };
  }
  return null;
}

type ChatLike = Message['chat'];

function chatTitle(chat: ChatLike): string | undefined {
  if (chat.type === 'private') {
    return [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username;
  }
  return chat.title;
}

export function extractIncoming(msg: Message): IncomingMessage | null {
  const media = extractMedia(msg);
  if (!media) return null;

  const sender =
    'from' in msg && msg.from
      ? {
          id: msg.from.id,
          name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
        }
      : undefined;

  return {
    chatId: msg.chat.id,
    messageId: msg.message_id,
    chatType: msg.chat.type,
    chatTitle: chatTitle(msg.chat),
    mediaGroupId: msg.media_group_id,
    senderId: sender?.id,
    senderName: sender?.name,
    caption: msg.caption,
    captionEntities: msg.caption_entities,
    messageDate: msg.date * 1000,
    media,
  };
}
