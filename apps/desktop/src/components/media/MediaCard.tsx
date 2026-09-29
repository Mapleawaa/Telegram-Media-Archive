import {
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import type { MediaListItem } from '@tma/shared';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { aiStatusLabel, categoryLabel, formatBytes, formatDuration, typeLabel } from '@/lib/format';
import { useState } from 'react';

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
};

export function MediaCard({ item }: { item: MediaListItem }) {
  const [imageFailed, setImageFailed] = useState(false);
  const Icon = TYPE_ICONS[item.type] ?? FileText;
  const showImage = item.hasThumbnail && !imageFailed;

  return (
    <Link
      to={`/media/${item.id}`}
      className="group overflow-hidden rounded-lg border bg-card transition-colors hover:border-ring"
    >
      <div className="relative flex aspect-video items-center justify-center bg-muted">
        {showImage ? (
          <img
            src={api.thumbnailUrl(item.id)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Icon className="size-8 text-muted-foreground/60" />
        )}
        <span
          className={cn(
            'absolute left-1.5 top-1.5 size-2 rounded-full ring-1 ring-background',
            AI_DOT[item.aiStatus] ?? 'bg-zinc-400',
          )}
          title={aiStatusLabel(item.aiStatus)}
        />
        {item.durationSec ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 text-[10px] leading-4 text-white">
            {formatDuration(item.durationSec)}
          </span>
        ) : null}
        {item.albumCount > 1 ? (
          <span
            className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] leading-3 text-white"
            title={`相册 · ${item.albumCount} 项`}
          >
            <Layers className="size-3" />
            {item.albumCount}
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5 p-2.5">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</div>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {typeLabel(item.type)}
          </Badge>
          {item.category ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {categoryLabel(item.category)}
            </Badge>
          ) : null}
          {item.quality ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {item.quality}
            </Badge>
          ) : null}
          <span>{formatBytes(item.sizeBytes)}</span>
          {item.sourceCount > 1 ? <span>· {item.sourceCount} 源</span> : null}
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function MediaRow({ item }: { item: MediaListItem }) {
  return (
    <Link
      to={`/media/${item.id}`}
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:border-ring"
    >
      <div className="w-40 shrink-0 truncate font-medium">{item.title}</div>
      <Badge variant="secondary" className="text-[10px]">
        {typeLabel(item.type)}
      </Badge>
      {item.category ? (
        <Badge variant="outline" className="text-[10px]">
          {categoryLabel(item.category)}
        </Badge>
      ) : null}
      {item.albumCount > 1 ? (
        <span className="flex items-center gap-0.5 text-muted-foreground" title={`相册 · ${item.albumCount} 项`}>
          <Layers className="size-3" />
          {item.albumCount}
        </span>
      ) : null}
      <span className="w-16 text-muted-foreground">{item.quality ?? '—'}</span>
      <span className="w-20 text-muted-foreground">{formatBytes(item.sizeBytes)}</span>
      <span className="w-24 text-muted-foreground">
        {item.durationSec ? formatDuration(item.durationSec) : '—'}
      </span>
      <span className="flex-1 truncate text-muted-foreground">{item.tags.join(' · ')}</span>
      <span className={cn('size-2 rounded-full', AI_DOT[item.aiStatus] ?? 'bg-zinc-400')} />
    </Link>
  );
}
