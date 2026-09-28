import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Database } from 'lucide-react';
import { Link } from 'react-router';
import { MediaCard } from '@/components/media/MediaCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useConnectionStore } from '@/stores/connection';

export function DashboardPage() {
  const online = useConnectionStore((s) => s.online);
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: api.stats,
    refetchInterval: online ? false : 15_000,
  });

  const data = stats.data;
  const pendingJobs = (data?.jobsByStatus.pending ?? 0) + (data?.jobsByStatus.running ?? 0);
  const failedJobs = (data?.jobsByStatus.failed ?? 0) + (data?.jobsByStatus.dead ?? 0);

  const cards = [
    { label: '媒体总数', value: data?.totalAssets ?? '—', icon: Database },
    { label: '今日归档', value: data?.todayAdded ?? '—', icon: CheckCircle2 },
    { label: '待处理任务', value: pendingJobs, icon: Clock },
    { label: '失败任务', value: failedJobs, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          {stats.isError ? 'Core 未连接' : `更新于 ${formatRelative(stats.dataUpdatedAt)}`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-normal text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">最近媒体</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/library">查看全部</Link>
          </Button>
        </div>
        {data && data.recentMedia.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {data.recentMedia.map((item) => (
              <MediaCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            暂无媒体
          </div>
        )}
      </div>

      {data && data.recentFailures.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium">最近失败任务</h2>
          <div className="space-y-1.5">
            {data.recentFailures.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm"
              >
                <Badge variant="destructive" className="text-[10px]">
                  {job.status}
                </Badge>
                <span className="font-medium">{job.type}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {job.error?.split('\n')[0]}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void api.retryJob(job.id)}
                >
                  重试
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
