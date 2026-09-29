import { useInfiniteQuery } from '@tanstack/react-query';
import { LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { clusterByAlbum, type MediaListQuery, type MediaType } from '@tma/shared';
import { MediaRow } from '@/components/media/MediaRow';
import { PosterGrid, PosterGridSkeleton } from '@/components/media/PosterGrid';
import { PrivacyNotice } from '@/components/media/PrivacyNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { filterByPrivacy, useSensitiveHidden } from '@/stores/privacy';
import { COVER_MODES, useUiStore } from '@/stores/ui';

const PAGE_SIZE = 24;

const CATEGORY_OPTIONS = [
  { value: 'movie', label: '电影' },
  { value: 'series', label: '剧集' },
  { value: 'anime', label: '动漫' },
  { value: 'adult', label: '成人' },
  { value: 'gallery', label: '图集' },
  { value: 'game', label: '游戏' },
  { value: 'book', label: '图书' },
  { value: 'other', label: '其他' },
];

const TYPE_OPTIONS = [
  { value: 'video', label: '视频' },
  { value: 'photo', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'animation', label: '动图' },
  { value: 'document', label: '文档' },
];

const SORT_OPTIONS = [
  { value: 'recent', label: '最新' },
  { value: 'updated', label: '最近更新' },
  { value: 'size', label: '大小' },
  { value: 'duration', label: '时长' },
  { value: 'year', label: '年份' },
];

const QUALITY_OPTIONS = ['2160p', '1440p', '1080p', '720p', '480p'];

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const coverMode = useUiStore((s) => s.coverMode);
  const setCoverMode = useUiStore((s) => s.setCoverMode);
  const sensitiveHidden = useSensitiveHidden();
  const [showFilters, setShowFilters] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const filters = useMemo(
    () => ({
      type: (params.get('type') as MediaType | null) ?? undefined,
      quality: params.get('quality') ?? undefined,
      year: params.get('year') ? Number(params.get('year')) : undefined,
      tag: params.get('tag') ?? undefined,
      category: params.get('category') ?? undefined,
      aiStatus: (params.get('aiStatus') as MediaListQuery['aiStatus']) ?? undefined,
    }),
    [params],
  );

  const sort = (params.get('sort') as MediaListQuery['sort'] | null) ?? 'recent';

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const query = useInfiniteQuery({
    queryKey: ['media', 'library', filters, sort],
    queryFn: ({ pageParam }) =>
      api.media({ ...filters, sort, limit: PAGE_SIZE, cursor: pageParam ?? undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [query]);

  // 相册聚簇（P3-3）：同 media_group_id 的条目拉到相邻位置，便于整组浏览
  const all = clusterByAlbum(query.data?.pages.flatMap((p) => p.items) ?? []);
  const { items, hiddenCount } = filterByPrivacy(all, sensitiveHidden);
  const filterKeys = Object.values(filters).filter(Boolean).length;
  const modeHint = COVER_MODES.find((m) => m.value === coverMode)?.hint ?? '';

  return (
    <div className="space-y-4 px-7 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">媒体库</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {query.isSuccess ? `${items.length} 项` : '加载中…'}
            {filterKeys > 0 ? ` · ${filterKeys} 个筛选条件` : ''}
            {items.length > 1 || hiddenCount > 0 ? ` · ${modeHint}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 封面排列模式（P4 第 2 轮：竖屏 / 方形 / 原始比例） */}
          {viewMode === 'grid' ? (
            <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
              {COVER_MODES.map((m) => (
                <Button
                  key={m.value}
                  size="sm"
                  variant={coverMode === m.value ? 'secondary' : 'ghost'}
                  className="h-7 px-2 text-[11px]"
                  title={m.hint}
                  onClick={() => setCoverMode(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
            <Button
              size="sm"
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              className="h-7 px-2"
              onClick={() => setViewMode('grid')}
              aria-label="网格视图"
            >
              <LayoutGrid className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              className="h-7 px-2"
              onClick={() => setViewMode('list')}
              aria-label="列表视图"
            >
              <List className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <PrivacyNotice hiddenCount={hiddenCount} />

      {/* 分类夹（对标影音客户端的一级导航，取代原先的下拉） */}
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        <Button
          size="sm"
          variant={filters.category ? 'ghost' : 'secondary'}
          className="h-7 shrink-0 rounded-full px-3 text-[12px]"
          onClick={() => setFilter('category', undefined)}
        >
          全部
        </Button>
        {CATEGORY_OPTIONS.map((c) => (
          <Button
            key={c.value}
            size="sm"
            variant={filters.category === c.value ? 'secondary' : 'ghost'}
            className="h-7 shrink-0 rounded-full px-3 text-[12px]"
            onClick={() =>
              setFilter('category', filters.category === c.value ? undefined : c.value)
            }
          >
            {c.label}
          </Button>
        ))}
      </div>

      {/* 筛选条：默认收起，只有排序常驻 —— 少一点「后台表单」味 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sort} onValueChange={(v) => setFilter('sort', v === 'recent' ? undefined : v)}>
          <SelectTrigger size="sm" className="h-8 w-28">
            <SelectValue placeholder="排序" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant={showFilters || filterKeys > 0 ? 'secondary' : 'ghost'}
          className="h-8 gap-1.5"
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal className="size-3.5" />
          筛选
          {filterKeys > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
              {filterKeys}
            </span>
          ) : null}
        </Button>

        {showFilters ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filters.type ?? 'all'}
              onValueChange={(v) => setFilter('type', v === 'all' ? undefined : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-28">
                <SelectValue placeholder="类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.quality ?? 'all'}
              onValueChange={(v) => setFilter('quality', v === 'all' ? undefined : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-28">
                <SelectValue placeholder="分辨率" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分辨率</SelectItem>
                {QUALITY_OPTIONS.map((q) => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.aiStatus ?? 'all'}
              onValueChange={(v) => setFilter('aiStatus', v === 'all' ? undefined : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-28">
                <SelectValue placeholder="AI 状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部 AI 状态</SelectItem>
                <SelectItem value="pending">待分析</SelectItem>
                <SelectItem value="partial">部分完成</SelectItem>
                <SelectItem value="done">已分析</SelectItem>
                <SelectItem value="failed">分析失败</SelectItem>
                <SelectItem value="manual">待分类</SelectItem>
              </SelectContent>
            </Select>

            <Input
              className="h-8 w-24"
              placeholder="年份"
              defaultValue={filters.year ?? ''}
              onBlur={(e) => setFilter('year', e.target.value || undefined)}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  setFilter('year', (e.target as HTMLInputElement).value || undefined);
              }}
            />
            <Input
              className="h-8 w-32"
              placeholder="标签"
              defaultValue={filters.tag ?? ''}
              onBlur={(e) => setFilter('tag', e.target.value || undefined)}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  setFilter('tag', (e.target as HTMLInputElement).value || undefined);
              }}
            />
          </div>
        ) : null}

        {filterKeys > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            清除
          </Button>
        )}
      </div>

      {query.isPending ? (
        <PosterGridSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          {all.length > 0 ? (
            <span className="flex items-center justify-center gap-2">
              <Search className="size-4" />
              当前条件下没有可显示的内容（敏感内容已被隐私模式隐藏）
            </span>
          ) : (
            '还没有媒体。把想归档的内容转发到归档群，Bot 会自动入库。'
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <PosterGrid items={items} />
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <MediaRow key={item.id} item={item} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className={cn('h-10')} />
      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  );
}
