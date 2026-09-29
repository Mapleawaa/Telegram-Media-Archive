import {
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Layers,
  Lock,
  Send,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { MediaListItem } from '@tma/shared';
import { ForwardDialog } from '@/components/media/ForwardDialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { categoryLabel, formatBytes, formatDuration } from '@/lib/format';
import { useUiStore, type CoverMode } from '@/stores/ui';

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

/** 原始比例模式的极端值收敛，避免超长条把网格撑坏 */
const MIN_RATIO = 0.55;
const MAX_RATIO = 2.4;

export interface PosterCardProps {
  item: MediaListItem;
  /** fixed：横向货架里固定宽度；fluid：网格里自适应 */
  variant?: 'fixed' | 'fluid';
  /** 覆盖全局封面模式（默认跟随 store） */
  mode?: CoverMode;
  className?: string;
}

/**
 * 海报式卡片（影音墙的基本单元）。
 * 三种封面模式：竖屏 2:3 裁切 / 方形 1:1 裁切 / 原始比例不裁切。
 * 悬停出快捷操作，右键出上下文菜单。
 */
export function PosterCard({ item, variant = 'fluid', mode, className }: PosterCardProps) {
  const [broken, setBroken] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  const globalMode = useUiStore((s) => s.coverMode);
  const cover = mode ?? globalMode;

  const Icon = TYPE_ICONS[item.type] ?? FileText;
  const showImage = item.hasThumbnail && !broken;

  const naturalRatio =
    item.width && item.height
      ? Math.min(Math.max(item.width / item.height, MIN_RATIO), MAX_RATIO)
      : null;

  const meta = [
    item.year ? String(item.year) : null,
    item.durationSec ? formatDuration(item.durationSec) : formatBytes(item.sizeBytes),
    item.sourceCount > 1 ? `${item.sourceCount} 源` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <>
      <Link
        to={`/media/${item.id}`}
        title={item.title}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={cn(
          'group/poster relative block overflow-hidden rounded-xl bg-card ring-1 ring-white/5',
          'transition duration-200 hover:z-10 hover:ring-primary/60 hover:shadow-[0_10px_40px_-12px_rgba(0,0,0,0.85)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          variant === 'fixed' ? 'w-[168px] shrink-0' : 'w-full',
          className,
        )}
      >
        <div
          className={cn(
            'relative w-full overflow-hidden bg-muted',
            cover === 'portrait' && 'aspect-2/3',
            cover === 'square' && 'aspect-square',
          )}
          style={
            cover === 'natural'
              ? { aspectRatio: String(naturalRatio ?? 2 / 3) }
              : undefined
          }
        >
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
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    AI_DOT[item.aiStatus] ?? 'bg-zinc-400',
                  )}
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

          {/* 悬停快捷操作（P4-5）：转发（外链动作需用户显式点击） */}
          <div className="pointer-events-none absolute inset-0 flex items-start justify-end gap-1 bg-gradient-to-b from-black/45 to-transparent p-1.5 opacity-0 transition-opacity group-hover/poster:opacity-100">
            <button
              type="button"
              title="转发到 Telegram"
              className="pointer-events-auto rounded-full bg-black/65 p-1.5 text-white/90 backdrop-blur-sm transition-colors hover:bg-primary hover:text-primary-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setForwardOpen(true);
              }}
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </div>
      </Link>

      {menu ? (
        <div
          className="fixed z-50 min-w-36 overflow-hidden rounded-lg border bg-popover py-1 text-[13px] text-popover-foreground shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-accent"
            onClick={() => {
              setMenu(null);
              void navigate(`/media/${item.id}`);
            }}
          >
            查看详情
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-accent"
            onClick={() => {
              setMenu(null);
              setForwardOpen(true);
            }}
          >
            转发到 Telegram
          </button>
        </div>
      ) : null}

      <ForwardDialog
        mediaId={item.id}
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        onForwarded={() => undefined}
      />
    </>
  );
}
