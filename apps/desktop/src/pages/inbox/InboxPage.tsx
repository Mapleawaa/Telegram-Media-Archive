import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { MediaListItem } from '@tma/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatBytes, formatRelative, typeLabel } from '@/lib/format';

function InboxRow({ item, onEnrich }: { item: MediaListItem; onEnrich?: (id: number) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
      <Link to={`/media/${item.id}`} className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {typeLabel(item.type)}
          </Badge>
          {item.quality && <span>{item.quality}</span>}
          <span>{formatBytes(item.sizeBytes)}</span>
          <span>{formatRelative(item.createdAt)}</span>
        </div>
      </Link>
      {onEnrich && (
        <Button size="sm" variant="outline" onClick={() => onEnrich(item.id)}>
          <Sparkles className="size-3.5" /> 分析
        </Button>
      )}
    </div>
  );
}

export function InboxPage() {
  const queryClient = useQueryClient();
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: api.inbox });

  const enrich = useMutation({
    mutationFn: (id: number) => api.enrich(id),
    onSuccess: (res) => {
      toast.success(res.deduped ? '已在队列中' : '已加入 AI 分析队列');
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '触发失败'),
  });

  if (inbox.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }

  const data = inbox.data ?? { pending: [], partial: [], failed: [], done: [] };
  const groups = [
    { key: 'pending', label: `待分析 (${data.pending.length})`, items: data.pending, action: true },
    { key: 'partial', label: `部分完成 (${data.partial.length})`, items: data.partial, action: true },
    { key: 'failed', label: `失败 (${data.failed.length})`, items: data.failed, action: true },
    { key: 'done', label: `已完成 (${data.done.length})`, items: data.done, action: false },
  ];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Inbox</h1>
        <p className="text-xs text-muted-foreground">
          AI 富化待办箱：待分析 / 部分完成 / 失败 / 最近完成。失败的可以一键重试。
        </p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          {groups.map((g) => (
            <TabsTrigger key={g.key} value={g.key}>
              {g.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {groups.map((g) => (
          <TabsContent key={g.key} value={g.key} className="mt-3">
            {g.items.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  {g.key === 'pending' ? '没有待分析的媒体' : '空'}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-1.5">
                {g.items.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    onEnrich={g.action ? (id) => enrich.mutate(id) : undefined}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5" />
        AI 未启用时媒体会直接标记为「跳过」，可在设置里检查 .env 的 AI 配置。
      </div>
    </div>
  );
}
