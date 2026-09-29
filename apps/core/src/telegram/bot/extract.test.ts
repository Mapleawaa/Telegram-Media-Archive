import type { Message } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { extractForwardOrigin, extractIncoming } from './extract.js';

function makeMessage(overrides: Record<string, unknown>): Message {
  return {
    message_id: 1,
    date: 1_700_000_000,
    chat: { id: -1002464626889, type: 'supergroup', title: '归档群' },
    video: {
      file_id: 'f1',
      file_unique_id: 'u1',
      width: 1920,
      height: 1080,
      duration: 60,
      file_name: 'a.mkv',
      file_size: 100,
    },
    ...overrides,
  } as unknown as Message;
}

describe('extractForwardOrigin', () => {
  it('forward_origin = user：记录原发送者 ID 与名称', () => {
    const origin = extractForwardOrigin(
      makeMessage({
        forward_origin: {
          type: 'user',
          date: 1_700_000_000,
          sender_user: { id: 4242, is_bot: false, first_name: 'Ada', last_name: 'Lovelace' },
        },
      }),
    );
    expect(origin).toEqual({ originType: 'user', senderUserId: 4242, senderName: 'Ada Lovelace' });
  });

  it('forward_origin = hidden_user：仅有名称，无 ID', () => {
    const origin = extractForwardOrigin(
      makeMessage({
        forward_origin: { type: 'hidden_user', date: 1_700_000_000, sender_user_name: '匿名用户' },
      }),
    );
    expect(origin).toEqual({ originType: 'hidden_user', senderName: '匿名用户' });
  });

  it('forward_origin = chat：记录来源群 ID / 标题 / 用户名', () => {
    const origin = extractForwardOrigin(
      makeMessage({
        forward_origin: {
          type: 'chat',
          date: 1_700_000_000,
          sender_chat: { id: -100111, type: 'supergroup', title: '资源群', username: 'res_group' },
        },
      }),
    );
    expect(origin).toEqual({
      originType: 'chat',
      chatId: -100111,
      chatTitle: '资源群',
      chatUsername: 'res_group',
    });
  });

  it('forward_origin = channel：记录频道 ID / 标题', () => {
    const origin = extractForwardOrigin(
      makeMessage({
        forward_origin: {
          type: 'channel',
          date: 1_700_000_000,
          chat: { id: -100222, type: 'channel', title: '影视频道' },
          message_id: 77,
        },
      }),
    );
    expect(origin).toEqual({ originType: 'channel', chatId: -100222, chatTitle: '影视频道', chatUsername: undefined });
  });

  it('兼容旧字段 forward_from_chat / forward_from / forward_sender_name', () => {
    expect(
      extractForwardOrigin(
        makeMessage({ forward_from_chat: { id: -100333, title: '旧群', username: 'old_group' } }),
      ),
    ).toEqual({ originType: 'chat', chatId: -100333, chatTitle: '旧群', chatUsername: 'old_group' });

    expect(
      extractForwardOrigin(makeMessage({ forward_from: { id: 99, first_name: 'Bob' } })),
    ).toEqual({ originType: 'user', senderUserId: 99, senderName: 'Bob' });

    expect(extractForwardOrigin(makeMessage({ forward_sender_name: '隐藏者' }))).toEqual({
      originType: 'hidden_user',
      senderName: '隐藏者',
    });
  });

  it('非转发消息：返回 undefined', () => {
    expect(extractForwardOrigin(makeMessage({}))).toBeUndefined();
  });

  it('extractIncoming 带上 forward 字段', () => {
    const incoming = extractIncoming(
      makeMessage({
        forward_origin: {
          type: 'channel',
          date: 1_700_000_000,
          chat: { id: -100222, type: 'channel', title: '影视频道' },
          message_id: 77,
        },
      }),
    );
    expect(incoming?.forward).toEqual({
      originType: 'channel',
      chatId: -100222,
      chatTitle: '影视频道',
      chatUsername: undefined,
    });
  });
});
