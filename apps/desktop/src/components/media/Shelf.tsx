import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import type { MediaListItem } from '@tma/shared';
import { PosterCard } from '@/components/media/PosterCard';
import { cn } from '@/lib/utils';

export interface ShelfProps {
  title: string;
  items: MediaListItem[];
  /** 「查看全部」的去向（带筛选参数） */
  to?: string;
  /** 显示计数（分类夹用） */
  count?: number;
  className?: string;
}

/**
 * 横向货架：一行海报卡，隐藏滚动条但可横滚（滚轮 / 触控板 / 拖拽）。
 * 影音客户端的标准浏览单位（Jellyfin / Emby / Apple TV 同构）。
 */
export function Shelf({ title, items, to, count, className }: ShelfProps) {
  if (items.length === 0) return null;

  return (
    <section className={cn('space-y-2.5', className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {typeof count === 'number' ? (
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        ) : null}
        {to ? (
          <Link
            to={to}
            className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            查看全部
            <ChevronRight className="size-3.5" />
          </Link>
        ) : null}
      </div>

      <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1.5">
        {items.map((item) => (
          <PosterCard key={item.id} item={item} variant="fixed" />
        ))}
      </div>
    </section>
  );
}
