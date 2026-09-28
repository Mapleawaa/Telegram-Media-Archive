import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const STATUS_VARIANT: Record<string, 'secondary' | 'destructive' | 'outline'> = {
  succeeded: 'secondary',
  failed: 'destructive',
  running: 'outline',
};

export function AiActivityPage() {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const runs = useQuery({
    queryKey: ['ai-runs'],
    queryFn: () => api.aiRuns(50),
    refetchInterval: 10_000,
  });
  const detail = useQuery({
    queryKey: ['ai-runs', selectedRunId],
    queryFn: () => api.aiRunDetail(selectedRunId!),
    enabled: selectedRunId !== null,
  });

  return (
    <div className="grid gap-5 p-6 lg:grid-cols-[2fr_3fr]">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">AI 活动</h1>
          <p className="text-xs text-muted-foreground">
            {runs.data ? `${runs.data.items.length} 次运行` : '加载中…'} · 每次调用都有完整的运行与步骤记录
          </p>
        </div>

        {runs.isPending ? (
          <Skeleton className="h-64 rounded-lg" />
        ) : (runs.data?.items.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              还没有 AI 运行记录。在 Inbox 里触发一次分析就能看到这里出现执行轨迹。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {runs.data!.items.map((run) => (
              <button
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:border-ring ${
                  selectedRunId === run.id ? 'border-ring bg-muted/50' : 'bg-card'
                }`}
              >
                <Badge variant={STATUS_VARIANT[run.status] ?? 'outline'} className="text-[10px]">
                  {run.status}
                </Badge>
                <span className="font-medium">{run.kind}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {run.userRequest ?? run.model ?? '—'}
                </span>
                {run.totalTokens ? (
                  <span className="text-[11px] text-muted-foreground">{run.totalTokens} tok</span>
                ) : null}
                <span className="text-[11px] text-muted-foreground">
                  {formatDateTime(run.startedAt)}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {selectedRunId === null ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              选择左侧一次运行，查看每一步的执行轨迹（模型调用 / 检索 / 决策）。
            </CardContent>
          </Card>
        ) : detail.isPending ? (
          <Skeleton className="h-72 rounded-lg" />
        ) : detail.data ? (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Run #{detail.data.id}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {detail.data.kind} · {detail.data.provider ?? '—'} · {detail.data.model ?? '—'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-xs text-muted-foreground">
                <div>开始：{formatDateTime(detail.data.startedAt)}</div>
                {detail.data.finishedAt && (
                  <div>
                    结束：{formatDateTime(detail.data.finishedAt)}（
                    {detail.data.finishedAt - detail.data.startedAt} ms）
                  </div>
                )}
                {detail.data.totalTokens != null && <div>Token：{detail.data.totalTokens}</div>}
                {detail.data.userRequest && <div>请求：{detail.data.userRequest}</div>}
                {detail.data.error && (
                  <div className="text-destructive">错误：{detail.data.error}</div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-2">
              {detail.data.steps.map((step) => (
                <div key={step.id} className="rounded-md border bg-card p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {String(step.stepIndex + 1).padStart(2, '0')}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {step.type}
                    </Badge>
                    <span className="font-medium">{step.toolName ?? '—'}</span>
                    <Badge
                      variant={STATUS_VARIANT[step.status] ?? 'outline'}
                      className="ml-auto text-[10px]"
                    >
                      {step.status}
                    </Badge>
                    {step.latencyMs != null && (
                      <span className="text-muted-foreground">{step.latencyMs} ms</span>
                    )}
                  </div>
                  {step.error && <div className="mt-2 text-[11px] text-destructive">{step.error}</div>}
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <JsonBlock value={step.input} />
                    <JsonBlock value={step.output} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              运行记录不存在
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
