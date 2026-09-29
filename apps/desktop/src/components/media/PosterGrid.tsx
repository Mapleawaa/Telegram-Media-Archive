import type { MediaListItem } from '@tma/shared';
import { PosterCard } from '@/components/media/PosterCard';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

const GRID_COLS =
  'grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8';
const MASONRY_COLS = 'columns-3 gap-3 sm:columns-4 lg:columns-5 xl:columns-6 2xl:columns-8';

export function PosterGrid({
  items,
  className,
}: {
  items: MediaListItem[];
  className?: string;
}) {
  const coverMode = useUiStore((s) => s.coverMode);

  // 原始比例：卡片高度不一，用多列（瀑布流）才不会被网格行高撕开
  if (coverMode === 'natural') {
    return (
      <div className={cn(MASONRY_COLS, className)}>
        {items.map((item) => (
          <div key={item.id} className="mb-3 break-inside-avoid">
            <PosterCard item={item} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn(GRID_COLS, className)}>
      {items.map((item) => (
        <PosterCard key={item.id} item={item} />
      ))}
    </div>
  );
}

/** 与 PosterGrid 同构的骨架，加载态不跳版 */
export function PosterGridSkeleton({ count = 12 }: { count?: number }) {
  const coverMode = useUiStore((s) => s.coverMode);
  const aspect = coverMode === 'square' ? 'aspect-square' : 'aspect-2/3';

  if (coverMode === 'natural') {
    return (
      <div className={MASONRY_COLS}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="mb-3 break-inside-avoid animate-pulse rounded-xl bg-muted"
            style={{ height: 160 + ((i * 37) % 120) }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={GRID_COLS}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn('animate-pulse rounded-xl bg-muted', aspect)} />
      ))}
    </div>
  );
}
