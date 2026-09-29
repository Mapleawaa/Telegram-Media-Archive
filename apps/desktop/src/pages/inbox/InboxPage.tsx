import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Sparkles, Tags } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { MediaListItem } from '@tma/shared';
import { ManualClassifyDialog } from '@/components/media/ManualClassifyDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatBytes, formatRelative, typeLabel } from '@/lib/format';

function InboxRow({
  item,
  onEnrich,
  onClassify,
}: {
  item: MediaListItem;
  onEnrich?: (id: number) => void;
  onClassify?: (item: MediaListItem) => void;
}) {
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
      {onClassify && (
        <Button size="sm" onClick={() => onClassify(item)}>
          <Tags className="size-3.5" /> 分类
        </Button>
      )}
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
  const [classifyTarget, setClassifyTarget] = useState<MediaListItem | null>(null);

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

  const data = inbox.data ?? { pending: [], partial: [], failed: [], done: [], manual: [] };
  const groups = [
    {
      key: 'manual',
      label: `待分类 (${data.manual.length})`,
      items: data.manual,
      action: 'classify' as const,
    },
    { key: 'pending', label: `待分析 (${data.pending.length})`, items: data.pending, action: 'enrich' as const },
    { key: 'partial', label: `部分完成 (${data.partial.length})`, items: data.partial, action: 'enrich' as const },
    { key: 'failed', label: `失败 (${data.failed.length})`, items: data.failed, action: 'enrich' as const },
    { key: 'done', label: `已完成 (${data.done.length})`, items: data.done, action: null },
  ];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Inbox</h1>
        <p className="text-xs text-muted-foreground">
          待分类＝命中「跳过 AI」来源、绝不进模型的内容，由你手工归类；其余为 AI 富化待办箱。
        </p>
      </div>

      <Tabs defaultValue={data.manual.length > 0 ? 'manual' : 'pending'}>
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
                  {g.key === 'pending'
                    ? '没有待分析的媒体'
                    : g.key === 'manual'
                      ? '没有待分类的媒体'
                      : '空'}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-1.5">
                {g.items.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    onEnrich={g.action === 'enrich' ? (id) => enrich.mutate(id) : undefined}
                    onClassify={g.action === 'classify' ? (it) => setClassifyTarget(it) : undefined}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5" />
        来源黑名单在「设置 → 来源与 AI 策略」配置；AI 未启用时媒体会直接标记为「跳过」。
      </div>

      <ManualClassifyDialog
        item={classifyTarget}
        open={classifyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setClassifyTarget(null);
        }}
      />
    </div>
  );
}
