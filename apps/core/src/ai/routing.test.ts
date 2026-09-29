import { describe, expect, it } from 'vitest';
import { createTestContext } from '../database/test-utils.js';
import { setSetting } from '../settings/store.js';
import { SETTING_KEYS } from '@tma/shared';
import type { ForwardOrigin } from '../telegram/types.js';
import { forwardSourceKey, getSkipSources, isSourceSkipped, parseSourceKey, resolveAiPolicy } from './routing.js';

describe('forwardSourceKey', () => {
  it('四种 origin 各自映射成策略 key', () => {
    expect(forwardSourceKey({ originType: 'channel', chatId: -100111 })).toBe('channel:-100111');
    expect(forwardSourceKey({ originType: 'chat', chatId: -100222 })).toBe('chat:-100222');
    expect(forwardSourceKey({ originType: 'user', senderUserId: 42 })).toBe('user:42');
    expect(forwardSourceKey({ originType: 'hidden_user', senderName: '匿名君' })).toBe('name:匿名君');
  });

  it('缺锚点时返回 undefined', () => {
    expect(forwardSourceKey(undefined)).toBeUndefined();
    expect(forwardSourceKey({ originType: 'channel' })).toBeUndefined();
    expect(forwardSourceKey({ originType: 'user' })).toBeUndefined();
    expect(forwardSourceKey({ originType: 'hidden_user', senderName: '   ' })).toBeUndefined();
  });
});

describe('parseSourceKey', () => {
  it('解析合法 key', () => {
    expect(parseSourceKey('channel:-100111')).toEqual({ type: 'channel', value: '-100111' });
    expect(parseSourceKey('name:匿名君')).toEqual({ type: 'name', value: '匿名君' });
  });

  it('拒绝非法 key', () => {
    expect(parseSourceKey('bogus:1')).toBeNull();
    expect(parseSourceKey('user:')).toBeNull();
    expect(parseSourceKey('noColon')).toBeNull();
  });
});

describe('resolveAiPolicy', () => {
  const cases: { name: string; origin: ForwardOrigin; key: string }[] = [
    { name: 'channel', origin: { originType: 'channel', chatId: -100111 }, key: 'channel:-100111' },
    { name: 'chat', origin: { originType: 'chat', chatId: -100222 }, key: 'chat:-100222' },
    { name: 'user', origin: { originType: 'user', senderUserId: 42 }, key: 'user:42' },
    { name: 'name（hidden_user）', origin: { originType: 'hidden_user', senderName: '匿名君' }, key: 'name:匿名君' },
  ];

  for (const c of cases) {
    it(`命中 ${c.name} 黑名单 → skip`, () => {
      const ctx = createTestContext();
      setSetting(ctx, SETTING_KEYS.aiSkipSources, [c.key]);
      const decision = resolveAiPolicy(ctx, c.origin);
      expect(decision.skip).toBe(true);
      expect(decision.matchedKey).toBe(c.key);
      expect(decision.sourceKey).toBe(c.key);
      expect(isSourceSkipped(ctx, c.key)).toBe(true);
    });
  }

  it('未配置策略时不跳过，但仍回填 sourceKey', () => {
    const ctx = createTestContext();
    const decision = resolveAiPolicy(ctx, { originType: 'chat', chatId: -100222 });
    expect(decision.skip).toBe(false);
    expect(decision.matchedKey).toBeUndefined();
    expect(decision.sourceKey).toBe('chat:-100222');
  });

  it('非转发消息永远不跳过', () => {
    const ctx = createTestContext();
    setSetting(ctx, SETTING_KEYS.aiSkipSources, ['chat:-100222']);
    const decision = resolveAiPolicy(ctx, undefined);
    expect(decision.skip).toBe(false);
    expect(decision.sourceKey).toBeUndefined();
  });

  it('settings 脏数据容错', () => {
    const ctx = createTestContext();
    setSetting(ctx, SETTING_KEYS.aiSkipSources, 'not-an-array');
    expect(getSkipSources(ctx)).toEqual([]);
    setSetting(ctx, SETTING_KEYS.aiSkipSources, [1, 'chat:-1', null, '']);
    expect(getSkipSources(ctx)).toEqual(['chat:-1']);
  });
});
