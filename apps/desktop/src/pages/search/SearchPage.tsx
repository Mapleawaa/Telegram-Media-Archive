import { useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { SearchResponse } from '@tma/shared';
import { MediaCard } from '@/components/media/MediaCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

const STRATEGY_LABELS: Record<string, string> = {
  fts: 'FTS5 · trigram',
  like: 'LIKE 子串（短查询）',
  none: '未执行',
};

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);

  const search = useMutation({
    mutationFn: (q: string) => api.search({ query: q, filters: {}, limit: 30 }),
    onSuccess: setResult,
  });

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold">搜索</h1>
        <p className="text-xs text-muted-foreground">
          标题 / 文件名 / 附言 / 标签联合检索；中文查询词需 ≥ 3 个字符走 FTS，短词自动用子串匹配。
        </p>
      </div>

      <form
        className="flex max-w-2xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search.mutate(query.trim());
        }}
      >
        <Input
          autoFocus
          placeholder="例如：绝命毒师 / 2160p / 赛博朋克"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" disabled={!query.trim() || search.isPending}>
          <SearchIcon className="size-4" />
          {search.isPending ? '搜索中…' : '搜索'}
        </Button>
      </form>

      {result && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{STRATEGY_LABELS[result.debug.strategy] ?? result.debug.strategy}</Badge>
          <span>候选 {result.debug.ftsHits} 条</span>
          <span>返回 {result.items.length} 条</span>
          <span>耗时 {result.debug.tookMs} ms</span>
        </div>
      )}

      {search.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {search.error instanceof Error ? search.error.message : '搜索失败'}
        </div>
      )}

      {result && result.items.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          没有命中「{query}」的媒体
        </div>
      )}

      {result && result.items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {result.items.map((item) => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
