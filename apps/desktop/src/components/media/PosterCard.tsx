import { FileAudio, FileText, FileVideo, Image as ImageIcon, Layers, Lock, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { MediaListItem } from '@tma/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { categoryLabel, formatBytes, formatDuration } from '@/lib/format';

const TYPE_ICONS: Record<string, LucideIcon> = {
  video: FileVideo,
  photo: ImageIcon,
  audio: FileAudio,
  document: FileText,
  animation: Layers,
};

const AI_DOT: Record<string, string> = {
  pending: 'bg-zinc-400',
  partial: 'bg-amber-500',
  done: 'bg-emerald-500',
  failed: 'bg-red-500',
  skipped: 'bg-zinc-300',
  manual: 'bg-sky-400',
};

export interface PosterCardProps {
  item: MediaListItem;
  /** fixed：横向货架里固定宽度；fluid：网格里自适应 */
  variant?: 'fixed' | 'fluid';
  className?: string;
}

/**
 * 海报式卡片（影音墙的基本单元）：2:3 竖版优先，图片铺满，
 * 底部渐变压字，标题最多两行。悬停时整卡提亮 + 描边。
 */
export function PosterCard({ item, variant = 'fluid', className }: PosterCardProps) {
  const [broken, setBroken] = useState(false);
  const Icon = TYPE_ICONS[item.type] ?? FileText;
  const showImage = item.hasThumbnail && !broken;

  const meta = [
    item.year ? String(item.year) : null,
    item.durationSec ? formatDuration(item.durationSec) : formatBytes(item.sizeBytes),
    item.sourceCount > 1 ? `${item.sourceCount} 源` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      to={`/media/${item.id}`}
      title={item.title}
      className={cn(
        'group/poster relative block overflow-hidden rounded-xl bg-card ring-1 ring-white/5',
        'transition duration-200 hover:z-10 hover:ring-primary/60 hover:shadow-[0_10px_40px_-12px_rgba(0,0,0,0.85)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        variant === 'fixed' ? 'w-[168px] shrink-0' : 'w-full',
        className,
      )}
    >
      <div className="relative aspect-2/3 w-full overflow-hidden bg-muted">
        {showImage ? (
          <img
            src={api.thumbnailUrl(item.id)}
            alt=""
            loading="lazy"
            className="size-full object-cover transition duration-300 group-hover/poster:scale-[1.04]"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Icon className="size-9 text-muted-foreground/50" />
          </div>
        )}

        {item.isSensitive ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white/90 backdrop-blur-sm">
            <Lock className="size-3" />
          </span>
        ) : null}

        {item.albumCount > 1 ? (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] leading-4 text-white backdrop-blur-sm">
            <Layers className="size-3" />
            {item.albumCount}
          </span>
        ) : null}

        {showImage ? (
          <>
            {/* 图上压字：统一用底部渐变压住，不依赖图片明暗 */}
            <div className="poster-shade absolute inset-x-0 bottom-0 h-3/5" />
            <div className="absolute inset-x-0 bottom-0 space-y-1 p-2.5">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full ring-1 ring-black/40',
                    AI_DOT[item.aiStatus] ?? 'bg-zinc-400',
                  )}
                />
                {item.category ? (
                  <span className="rounded bg-white/15 px-1 py-px text-[10px] leading-4 text-white/90 backdrop-blur-sm">
                    {categoryLabel(item.category)}
                  </span>
                ) : null}
                {meta ? (
                  <span className="truncate text-[10px] leading-4 text-white/70">{meta}</span>
                ) : null}
              </div>
              <div className="line-clamp-2 text-[12.5px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                {item.title}
              </div>
            </div>
          </>
        ) : (
          /* 无图：不要压深色渐变（浅色主题下会像一块黑斑），改用主题色文字 */
          <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-card to-transparent p-2.5 pt-6">
            <div className="flex items-center gap-1.5">
              <span
                className={cn('size-1.5 shrink-0 rounded-full', AI_DOT[item.aiStatus] ?? 'bg-zinc-400')}
              />
              {item.category ? (
                <span className="rounded bg-muted px-1 py-px text-[10px] leading-4 text-muted-foreground">
                  {categoryLabel(item.category)}
                </span>
              ) : null}
              {meta ? (
                <span className="truncate text-[10px] leading-4 text-muted-foreground">{meta}</span>
              ) : null}
            </div>
            <div className="line-clamp-2 text-[12.5px] font-medium leading-snug text-foreground">
              {item.title}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
