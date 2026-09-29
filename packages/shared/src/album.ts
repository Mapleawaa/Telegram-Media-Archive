/**
 * 相册聚簇（P3-3）：把同一 `mediaGroupId` 的条目拉到相邻位置。
 *
 * 为什么放 shared：纯函数、无依赖，桌面端（LibraryPage）直接消费，
 * 后端测试（core 的 vitest）可以直接覆盖，避免前端再引一套测试运行器。
 *
 * 语义：
 *   - **稳定**：不改变整体相对顺序，只把同组成员提前到该组**首次出现**的位置；
 *   - 无 `mediaGroupId` 的条目保持原位；
 *   - 只对「已加载的这一页」聚簇——跨页的相册不会被拼回一起（P4 若要看整组，
 *     可按 group 查询而不是分页）。
 */
export interface AlbumGrouppable {
  id: number;
  mediaGroupId: string | null;
}

export function clusterByAlbum<T extends AlbumGrouppable>(items: readonly T[]): T[] {
  const members = new Map<string, T[]>();
  for (const item of items) {
    const g = item.mediaGroupId;
    if (!g) continue;
    const list = members.get(g);
    if (list) list.push(item);
    else members.set(g, [item]);
  }

  const emitted = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const g = item.mediaGroupId;
    if (!g) {
      out.push(item);
      continue;
    }
    if (emitted.has(g)) continue;
    emitted.add(g);
    out.push(...(members.get(g) ?? [item]));
  }
  return out;
}

/** 单个相册成员数（1 = 非相册） */
export function albumSize(items: readonly AlbumGrouppable[], mediaGroupId: string | null): number {
  if (!mediaGroupId) return 1;
  return items.filter((i) => i.mediaGroupId === mediaGroupId).length;
}
