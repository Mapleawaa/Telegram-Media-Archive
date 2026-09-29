/**
 * 相册聚簇（P3-3）：被测函数在 @tma/shared（桌面端消费），
 * 这里用 core 的 vitest 覆盖，避免前端再引一套测试运行器。
 */
import { albumSize, clusterByAlbum } from '@tma/shared';
import { describe, expect, it } from 'vitest';

function item(id: number, mediaGroupId: string | null = null) {
  return { id, mediaGroupId };
}

describe('clusterByAlbum', () => {
  it('把同相册条目拉到该组首次出现的位置', () => {
    const input = [item(1), item(2, 'g1'), item(3), item(4, 'g1'), item(5, 'g2'), item(6, 'g2')];
    expect(clusterByAlbum(input).map((i) => i.id)).toEqual([1, 2, 4, 3, 5, 6]);
  });

  it('无相册的条目保持原位、相对顺序不变', () => {
    const input = [item(1), item(2), item(3)];
    expect(clusterByAlbum(input).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('已相邻的相册不被打乱（幂等）', () => {
    const input = [item(1, 'g1'), item(2, 'g1'), item(3), item(4, 'g2')];
    expect(clusterByAlbum(input).map((i) => i.id)).toEqual([1, 2, 3, 4]);
    // 再聚一次结果相同
    expect(clusterByAlbum(clusterByAlbum(input)).map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });

  it('不修改入参、不丢条目', () => {
    const input = [item(1, 'g1'), item(2), item(3, 'g1')];
    const snapshot = input.map((i) => i.id);
    const out = clusterByAlbum(input);
    expect(input.map((i) => i.id)).toEqual(snapshot);
    expect(out).toHaveLength(input.length);
  });

  it('albumSize 统计同组成员数', () => {
    const items = [item(1, 'g1'), item(2), item(3, 'g1')];
    expect(albumSize(items, 'g1')).toBe(2);
    expect(albumSize(items, null)).toBe(1);
    expect(albumSize(items, 'nope')).toBe(0);
  });
});
