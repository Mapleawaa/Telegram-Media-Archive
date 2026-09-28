import { describe, expect, it } from 'vitest';
import { buildDedupeKey, normalizeFilenameForDedupe } from './dedupe.js';

describe('dedupe', () => {
  it('规范化：去扩展名/括号/分隔符', () => {
    expect(normalizeFilenameForDedupe('Breaking_Bad.S05E10.2160p.[RARBG].mkv')).toBe(
      'breaking bad s05e10 2160p',
    );
  });

  it('相同文件不同写法产生相同 key', () => {
    const a = buildDedupeKey('Movie.Title.2024.1080p.mkv', 123456, 7200);
    const b = buildDedupeKey('Movie_Title_2024_1080p.mp4', 123456, 7200);
    expect(a).toBe(b);
  });

  it('size 或 duration 不同则 key 不同', () => {
    const a = buildDedupeKey('Movie.mkv', 100, 60);
    const b = buildDedupeKey('Movie.mkv', 101, 60);
    const c = buildDedupeKey('Movie.mkv', 100, 61);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('无文件名时仍可生成稳定 key', () => {
    const a = buildDedupeKey(undefined, 42, null);
    const b = buildDedupeKey(undefined, 42, null);
    expect(a).toBe(b);
  });
});
