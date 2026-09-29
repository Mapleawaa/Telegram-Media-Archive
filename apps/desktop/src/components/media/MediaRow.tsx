import { FileAudio, FileText, FileVideo, Image as ImageIcon, Layers, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { MediaListItem } from '@tma/shared';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { categoryLabel, formatBytes, formatDuration, typeLabel } from '@/lib/format';

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

/** 列表行：左侧小海报 + 一行元数据（密集浏览用，跟海报墙互补） */
export function MediaRow({ item }: { item: MediaListItem }) {
  const [broken, setBroken] = useState(false);
  const Icon = TYPE_ICONS[item.type] ?? FileText;
  const showImage = item.hasThumbnail && !broken;

  return (
    <Link
      to={`/media/${item.id}`}
      className="flex items-center gap-3 rounded-lg border border-transparent bg-card px-2.5 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="relative h-[54px] w-9 shrink-0 overflow-hidden rounded-md bg-muted">
        {showImage ? (
          <img
            src={api.thumbnailUrl(item.id)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Icon className="size-4 text-muted-foreground/60" />
          </div>
        )}
      </div>

      <div className="w-64 min-w-0 shrink-0">
        <div className="truncate font-medium">{item.title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{item.tags.join(' · ')}</div>
      </div>

      <Badge variant="secondary" className="text-[10px]">
        {typeLabel(item.type)}
      </Badge>
      {item.category ? (
        <Badge variant="outline" className="text-[10px]">
          {categoryLabel(item.category)}
        </Badge>
      ) : null}
      {item.albumCount > 1 ? (
        <span
          className="flex items-center gap-0.5 text-[11px] text-muted-foreground"
          title={`相册 · ${item.albumCount} 项`}
        >
          <Layers className="size-3" />
          {item.albumCount}
        </span>
      ) : null}
      <span className="w-14 shrink-0 text-[12px] tabular-nums text-muted-foreground">
        {item.quality ?? '—'}
      </span>
      <span className="w-16 shrink-0 text-[12px] tabular-nums text-muted-foreground">
        {formatBytes(item.sizeBytes)}
      </span>
      <span className="w-16 shrink-0 text-[12px] tabular-nums text-muted-foreground">
        {item.durationSec ? formatDuration(item.durationSec) : '—'}
      </span>
      <span className="flex-1" />
      <span className={cn('size-2 shrink-0 rounded-full', AI_DOT[item.aiStatus] ?? 'bg-zinc-400')} />
    </Link>
  );
}
