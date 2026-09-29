import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Film, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { PrivacyNotice } from '@/components/media/PrivacyNotice';
import { Shelf } from '@/components/media/Shelf';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { categoryLabel, formatBytes, formatDuration } from '@/lib/format';
import { filterByPrivacy, useSensitiveHidden } from '@/stores/privacy';

const RECENT_LIMIT = 18;

export function HomePage() {
  const recent = useQuery({
    queryKey: ['media', 'home-recent', RECENT_LIMIT],
    queryFn: () => api.media({ sort: 'recent', limit: RECENT_LIMIT }),
  });
  const sections = useQuery({
    queryKey: ['library-sections'],
    queryFn: api.librarySections,
  });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  const sensitiveHidden = useSensitiveHidden();
  const { items, hiddenCount } = filterByPrivacy(recent.data?.items ?? [], sensitiveHidden);
  const hero = items[0];
  const heroDetail = useQuery({
    queryKey: ['media', hero?.id],
    queryFn: () => api.mediaDetail(hero!.id),
    enabled: Boolean(hero),
  });

  // 分类行只显示有内容的（未分类夹排在最后）；每行的预览也按隐私模式过滤
  const shelves = useMemo(() => {
    const out: { key: string; label: string; count: number; items: typeof items }[] = [];
    for (const s of sections.data?.sections ?? []) {
      const filtered = filterByPrivacy(s.items, sensitiveHidden);
      const count = s.count - filtered.hiddenCount;
      if (count <= 0 || filtered.items.length === 0) continue;
      out.push({ key: s.key, label: s.label, count, items: filtered.items });
    }
    return out;
  }, [sections.data, sensitiveHidden, items]);

  const failed = (stats.data?.jobsByStatus.failed ?? 0) + (stats.data?.jobsByStatus.dead ?? 0);

  return (
    <div className="space-y-8 px-7 py-6">
      <PrivacyNotice hiddenCount={hiddenCount} />

      {/* ---- Hero：最新一条 ---- */}
      {hero ? (
        <section className="relative overflow-hidden rounded-2xl ring-1 ring-white/10">
          <div className="absolute inset-0">
            {hero.hasThumbnail ? (
              <img
                src={api.thumbnailUrl(hero.id)}
                alt=""
                className="size-full scale-105 object-cover"
              />
            ) : (
              <div className="size-full bg-gradient-to-br from-zinc-800 to-zinc-950" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/92 via-black/72 to-black/25" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
          </div>

          <div className="relative flex min-h-[360px] flex-col justify-end gap-3 p-7">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
              <span className="rounded-full bg-white/15 px-2 py-0.5 backdrop-blur-sm">最新归档</span>
              {hero.category ? (
                <span className="rounded-full bg-primary/85 px-2 py-0.5 font-medium text-primary-foreground">
                  {categoryLabel(hero.category)}
                </span>
              ) : null}
              <span className="flex items-center gap-1">
                <Film className="size-3" />
                {formatBytes(hero.sizeBytes)}
              </span>
              {hero.durationSec ? <span>{formatDuration(hero.durationSec)}</span> : null}
              {hero.year ? <span>{hero.year}</span> : null}
              {hero.sourceCount > 1 ? <span>{hero.sourceCount} 个来源</span> : null}
            </div>

            <h1 className="max-w-3xl text-[28px] font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
              {hero.title}
            </h1>

            {heroDetail.data?.metadata?.summary ? (
              <p className="line-clamp-2 max-w-3xl text-[13px] leading-relaxed text-white/75">
                {heroDetail.data.metadata.summary.split('\n')[0]}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button asChild size="sm" className="gap-1.5">
                <Link to={`/media/${hero.id}`}>
                  查看详情
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link to="/library">浏览媒体库</Link>
              </Button>
            </div>
          </div>
        </section>
      ) : recent.isPending ? (
        <Skeleton className="h-[360px] rounded-2xl" />
      ) : (
        <div className="rounded-2xl border border-dashed p-14 text-center">
          <Sparkles className="mx-auto mb-3 size-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            还没有媒体。把想归档的内容转发到归档群，Bot 会自动入库。
          </p>
        </div>
      )}

      {/* ---- 运维薄条：只在有失败任务时显眼 ---- */}
      {failed > 0 ? (
        <Link
          to="/inbox"
          className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-400"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{failed} 个任务失败或已放弃，去 Inbox 看看</span>
          <ArrowRight className="ml-auto size-3.5" />
        </Link>
      ) : null}

      {/* ---- 最近归档 ---- */}
      {recent.isPending ? (
        <div className="space-y-2.5">
          <Skeleton className="h-5 w-24" />
          <div className="flex gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-[252px] w-[168px] shrink-0 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <Shelf
          title="最近归档"
          items={items.slice(1)}
          to="/library"
          className={items.length > 1 ? undefined : 'hidden'}
        />
      )}

      {/* ---- 分类行 ---- */}
      {shelves.map((section) => (
        <Shelf
          key={section.key}
          title={section.label}
          count={section.count}
          items={section.items}
          to={
            section.key === '__none__'
              ? '/library'
              : `/library?category=${encodeURIComponent(section.key)}`
          }
        />
      ))}

      {/* ---- 底部：轻量统计（不做仪表盘） ---- */}
      {stats.data ? (
        <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground">
          <Sparkles className="size-3.5" />
          <span className="tabular-nums">共 {stats.data.totalAssets} 条</span>
          <span>·</span>
          <span className="tabular-nums">今日 +{stats.data.todayAdded}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1 text-[11px] text-muted-foreground"
            onClick={() => {
              void recent.refetch();
              void sections.refetch();
              void stats.refetch();
            }}
          >
            <RefreshCw className="size-3" />
            刷新
          </Button>
        </div>
      ) : null}
    </div>
  );
}
