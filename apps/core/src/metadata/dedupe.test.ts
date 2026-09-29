import { describe, expect, it } from 'vitest';
import { buildDedupeKey, normalizeFilenameForDedupe } from './dedupe.js';

describe('dedupe', () => {
  it('规范化：去扩展名/括号/分隔符', () => {
    expect(normalizeFilenameForDedupe('Breaking_Bad.S05E10.2160p.[RARBG].mkv')).toBe(
      'breaking bad s05e10 2160p',
    );
  });

  it('相同文件不同写法产生相同 key', () => {
    const a = buildDedupeKey({ fileName: 'Movie.Title.2024.1080p.mkv', size: 123456, durationSec: 7200, fileUniqueId: 'u1' });
    const b = buildDedupeKey({ fileName: 'Movie_Title_2024_1080p.mp4', size: 123456, durationSec: 7200, fileUniqueId: 'u2' });
    expect(a).toBe(b);
  });

  it('size 或 duration 不同则 key 不同', () => {
    const a = buildDedupeKey({ fileName: 'Movie.mkv', size: 100, durationSec: 60, fileUniqueId: 'u1' });
    const b = buildDedupeKey({ fileName: 'Movie.mkv', size: 101, durationSec: 60, fileUniqueId: 'u2' });
    const c = buildDedupeKey({ fileName: 'Movie.mkv', size: 100, durationSec: 61, fileUniqueId: 'u3' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('无文件名（照片）不参与二级去重：同大小的两张图 key 仍不同', () => {
    const a = buildDedupeKey({ fileName: null, size: 93578, durationSec: null, fileUniqueId: 'photo-A' });
    const b = buildDedupeKey({ fileName: null, size: 93578, durationSec: null, fileUniqueId: 'photo-B' });
    expect(a).not.toBe(b);
    expect(a).toContain('photo-A');
  });

  it('无文件名时同一文件稳定（同 fileUniqueId）', () => {
    const a = buildDedupeKey({ fileName: undefined, size: 42, durationSec: null, fileUniqueId: 'same' });
    const b = buildDedupeKey({ fileName: undefined, size: 42, durationSec: null, fileUniqueId: 'same' });
    expect(a).toBe(b);
  });
});
