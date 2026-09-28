import { useInfiniteQuery } from '@tanstack/react-query';
import { LayoutGrid, List } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import type { MediaListQuery, MediaType } from '@tma/shared';
import { MediaCard, MediaRow } from '@/components/media/MediaCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useUiStore } from '@/stores/ui';

const PAGE_SIZE = 24;

const TYPE_OPTIONS = [
  { value: 'video', label: '视频' },
  { value: 'photo', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'animation', label: '动图' },
  { value: 'document', label: '文档' },
];

const QUALITY_OPTIONS = ['2160p', '1440p', '1080p', '720p', '480p'];

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const filters = useMemo(
    () => ({
      type: (params.get('type') as MediaType | null) ?? undefined,
      quality: params.get('quality') ?? undefined,
      year: params.get('year') ? Number(params.get('year')) : undefined,
      tag: params.get('tag') ?? undefined,
      aiStatus: (params.get('aiStatus') as MediaListQuery['aiStatus']) ?? undefined,
    }),
    [params],
  );

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const query = useInfiniteQuery({
    queryKey: ['media', 'library', filters],
    queryFn: ({ pageParam }) =>
      api.media({ ...filters, limit: PAGE_SIZE, cursor: pageParam ?? undefined }),
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

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const filterKeys = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">媒体库</h1>
          <p className="text-xs text-muted-foreground">
            {query.isSuccess ? `${items.length} 项` : '加载中…'}
            {filterKeys > 0 ? ` · ${filterKeys} 个筛选条件` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <Button
            size="sm"
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            onClick={() => setViewMode('grid')}
            aria-label="网格视图"
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            onClick={() => setViewMode('list')}
            aria-label="列表视图"
          >
            <List className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.type ?? 'all'}
          onValueChange={(v) => setFilter('type', v === 'all' ? undefined : v)}
        >
          <SelectTrigger size="sm" className="w-28">
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
          <SelectTrigger size="sm" className="w-28">
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
          <SelectTrigger size="sm" className="w-28">
            <SelectValue placeholder="AI 状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部 AI 状态</SelectItem>
            <SelectItem value="pending">待分析</SelectItem>
            <SelectItem value="partial">部分完成</SelectItem>
            <SelectItem value="done">已分析</SelectItem>
            <SelectItem value="failed">分析失败</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="h-8 w-28"
          placeholder="年份"
          defaultValue={filters.year ?? ''}
          onBlur={(e) => setFilter('year', e.target.value || undefined)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilter('year', (e.target as HTMLInputElement).value || undefined);
          }}
        />
        <Input
          className="h-8 w-36"
          placeholder="标签"
          defaultValue={filters.tag ?? ''}
          onBlur={(e) => setFilter('tag', e.target.value || undefined)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilter('tag', (e.target as HTMLInputElement).value || undefined);
          }}
        />
        {filterKeys > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            清除筛选
          </Button>
        )}
      </div>

      {query.isPending ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          还没有媒体。把想归档的内容转发到归档群，Bot 会自动入库。
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <MediaRow key={item.id} item={item} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-10" />
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
