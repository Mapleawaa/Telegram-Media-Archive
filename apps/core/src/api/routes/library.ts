/**
 * 分类夹 API（P3-5）：`GET /api/library/sections`
 * 返回「分类夹 + 计数 + 预览图」，供 P4 影音墙按分类横向行渲染。
 *
 * 六类预设恒定出现（计数可为 0，保证 UI 稳定）；库里出现的自定义分类与「未分类」
 * （category IS NULL 且有内容时）追加在后。
 */
import {
  CATEGORY_PRESETS,
  type LibrarySection,
  type LibrarySectionsResponse,
} from '@tma/shared';
import type { AppContext } from '../../context.js';
import { categoryCounts, categoryLabel, UNCATEGORIZED_KEY } from '../../metadata/category.js';
import { queryMedia } from '../../media/queries.js';
import type { AppServer } from '../types.js';

const PREVIEW_LIMIT = 12;

export function registerLibraryRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/library/sections', async (): Promise<LibrarySectionsResponse> => {
    const counts = categoryCounts(ctx);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);

    const presetKeys = new Set<string>(CATEGORY_PRESETS);
    const customKeys = [...counts.keys()]
      .filter((k) => k !== UNCATEGORIZED_KEY && !presetKeys.has(k))
      .sort();

    // 顺序：六类预设（固定顺序）→ 自定义分类（字母序）→ 未分类（有内容才出现）
    const orderedKeys: string[] = [...CATEGORY_PRESETS, ...customKeys];
    if ((counts.get(UNCATEGORIZED_KEY) ?? 0) > 0) orderedKeys.push(UNCATEGORIZED_KEY);

    const sections: LibrarySection[] = orderedKeys.map((key) => ({
      key,
      label: categoryLabel(key),
      count: counts.get(key) ?? 0,
      items: queryMedia(ctx.sqlite, {
        filters: { category: key },
        limit: PREVIEW_LIMIT,
        order: 'recent',
      }).items,
    }));

    return { sections, total };
  });
}
