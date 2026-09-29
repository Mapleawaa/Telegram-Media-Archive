import { useEffect, useMemo, useRef, useState } from 'react';
import { Search as SearchIcon, SlidersHorizontal } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type { MediaType, SearchFilters, SearchResponse } from '@tma/shared';
import { PosterGrid } from '@/components/media/PosterGrid';
import { PrivacyNotice } from '@/components/media/PrivacyNotice';
import { Badge } from '@/components/ui/badge';
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
import { filterByPrivacy, useSensitiveHidden } from '@/stores/privacy';

const STRATEGY_LABELS: Record<string, string> = {
  hybrid: 'Hybrid · FTS + 向量（RRF 融合）',
  fts: 'FTS5 · trigram',
  like: 'LIKE 子串（短查询）',
  none: '未执行',
};

const TYPE_OPTIONS = [
  { value: 'video', label: '视频' },
  { value: 'photo', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'animation', label: '动图' },
  { value: 'document', label: '文档' },
];

const CATEGORY_OPTIONS = [
  { value: 'movie', label: '电影' },
  { value: 'series', label: '剧集' },
  { value: 'anime', label: '动漫' },
  { value: 'adult', label: '成人' },
  { value: 'gallery', label: '图集' },
  { value: 'other', label: '其他' },
];

const QUALITY_OPTIONS = ['2160p', '1440p', '1080p', '720p', '480p'];

export function SearchPage() {
  const [params] = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const sensitiveHidden = useSensitiveHidden();
  const autoRan = useRef(false);

  const search = useMutation({
    mutationFn: (payload: { q: string; filters: SearchFilters }) =>
      api.search({ query: payload.q, filters: payload.filters, limit: 30 }),
    onSuccess: setResult,
  });

  // 快捷键 `/` 会带着 ?q= 跳过来 → 自动执行一次
  useEffect(() => {
    if (initialQuery && !autoRan.current) {
      autoRan.current = true;
      search.mutate({ q: initialQuery, filters: {} });
    }
  }, [initialQuery, search]);

  const all = result?.items ?? [];
  const { items, hiddenCount } = useMemo(
    () => filterByPrivacy(all, sensitiveHidden),
    [all, sensitiveHidden],
  );
  const filterKeys = Object.values(filters).filter(
    (v) => v !== undefined && v !== '',
  ).length;

  const run = (nextFilters = filters) => {
    if (query.trim()) search.mutate({ q: query.trim(), filters: nextFilters });
  };

  const patchFilter = (patch: Partial<SearchFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (result) run(next);
  };

  return (
    <div className="space-y-5 px-7 py-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">搜索</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          标题 / 文件名 / 附言 / 标签联合检索；中文查询词需 ≥ 3 个字符走 FTS，短词自动用子串匹配。
        </p>
      </div>

      <form
        className="flex max-w-2xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Input
          autoFocus
          data-search-input
          placeholder="例如：绝命毒师 / 2160p / 赛博朋克"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" disabled={!query.trim() || search.isPending}>
          <SearchIcon className="size-4" />
          {search.isPending ? '搜索中…' : '搜索'}
        </Button>
        <Button
          type="button"
          variant={showFilters || filterKeys > 0 ? 'secondary' : 'outline'}
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal className="size-4" />
          筛选
          {filterKeys > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
              {filterKeys}
            </span>
          ) : null}
        </Button>
      </form>

      {/* 筛选器（B7：与媒体库同一套条件） */}
      {showFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.type ?? 'all'}
            onValueChange={(v) =>
              patchFilter({ type: v === 'all' ? undefined : (v as MediaType) })
            }
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
            value={filters.category ?? 'all'}
            onValueChange={(v) => patchFilter({ category: v === 'all' ? undefined : v })}
          >
            <SelectTrigger size="sm" className="h-8 w-28">
              <SelectValue placeholder="分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {CATEGORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.quality ?? 'all'}
            onValueChange={(v) => patchFilter({ quality: v === 'all' ? undefined : v })}
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

          <Input
            className="h-8 w-24"
            placeholder="年份"
            defaultValue={filters.year ?? ''}
            onBlur={(e) => patchFilter({ year: e.target.value ? Number(e.target.value) : undefined })}
          />
          <Input
            className="h-8 w-32"
            placeholder="标签"
            defaultValue={filters.tag ?? ''}
            onBlur={(e) => patchFilter({ tag: e.target.value || undefined })}
          />
          {filterKeys > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setFilters({});
                run({});
              }}
            >
              清除
            </Button>
          )}
        </div>
      ) : null}

      {result && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            {STRATEGY_LABELS[result.debug.strategy] ?? result.debug.strategy}
          </Badge>
          <span>FTS {result.debug.ftsHits} 条</span>
          <span>向量 {result.debug.vectorHits} 条</span>
          <span>返回 {items.length} 条</span>
          <span>耗时 {result.debug.tookMs} ms</span>
        </div>
      )}

      <PrivacyNotice hiddenCount={hiddenCount} />

      {search.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {search.error instanceof Error ? search.error.message : '搜索失败'}
        </div>
      )}

      {result && items.length === 0 && (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          {all.length > 0
            ? '命中的内容都被隐私模式隐藏了（可点上方「临时显示」）'
            : `没有命中「${query}」的媒体`}
        </div>
      )}

      {items.length > 0 && <PosterGrid items={items} />}
    </div>
  );
}
