import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Send,
  Star,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import type { MediaDetail } from '@tma/shared';
import { ForwardDialog } from '@/components/media/ForwardDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import {
  aiStatusLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  telegramMessageUrl,
  typeLabel,
} from '@/lib/format';

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 font-mono">
        <span className="max-w-56 truncate" title={value}>
          {value}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span>{value === null || value === undefined || value === '' ? '—' : value}</span>
    </div>
  );
}

export function MediaDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const queryClient = useQueryClient();
  const [tagDraft, setTagDraft] = useState('');
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [forwardOpen, setForwardOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.mediaDetail(id),
    enabled: Number.isInteger(id) && id > 0,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['media', id] });
    void queryClient.invalidateQueries({ queryKey: ['media'] });
  };

  const addTag = useMutation({
    mutationFn: (tag: string) => api.addTag(id, tag),
    onSuccess: () => {
      setTagDraft('');
      invalidate();
    },
  });

  const removeTag = useMutation({
    mutationFn: (tag: string) => api.removeTag(id, tag),
    onSuccess: invalidate,
  });

  const annotate = useMutation({
    mutationFn: (text: string) => api.annotate(id, text),
    onSuccess: () => {
      setAnnotationDraft('');
      invalidate();
    },
  });

  if (detail.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <Skeleton className="aspect-video rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          媒体不存在或 Core 未连接。
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <Link to="/library">返回媒体库</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const d: MediaDetail = detail.data;
  const primary = d.sources.find((s) => s.isPrimary) ?? d.sources[0];
  const tgUrl = primary ? telegramMessageUrl(primary.chatId, primary.messageId) : null;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{d.title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            #{d.id} · {typeLabel(d.type)} · {formatBytes(d.sizeBytes)}
            {d.durationSec ? ` · ${formatDuration(d.durationSec)}` : ''}
            {d.width && d.height ? ` · ${d.width}×${d.height}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setForwardOpen(true)}>
            <Send className="size-4" /> 转发到…
          </Button>
          {tgUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={tgUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Telegram
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border bg-muted">
            {d.hasThumbnail ? (
              <img src={api.thumbnailUrl(d.id)} alt="" className="w-full object-contain" />
            ) : (
              <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
                无缩略图
              </div>
            )}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">确定性字段</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Field label="类型" value={typeLabel(d.type)} />
              <Field label="MIME" value={d.mime} />
              <Field label="大小" value={formatBytes(d.sizeBytes)} />
              <Field label="时长" value={d.durationSec ? formatDuration(d.durationSec) : null} />
              <Field label="分辨率" value={d.width && d.height ? `${d.width}×${d.height}` : null} />
              <Field label="年份" value={d.metadata?.year} />
              <Field label="季/集" value={d.metadata?.season ? `S${d.metadata.season}E${d.metadata.episode ?? '?'}` : null} />
              <Field label="来源标记" value={d.metadata?.source} />
              <Field label="AI 状态" value={aiStatusLabel(d.aiStatus)} />
              <div className="my-1 border-t" />
              <CopyField label="file_unique_id" value={d.fileUniqueId} />
              {primary && <CopyField label="chat / message" value={`${primary.chatId} / ${primary.messageId}`} />}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">标签</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="flex flex-wrap gap-1.5">
                {d.tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">还没有标签</span>
                )}
                {d.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button
                      className="rounded-full p-0.5 hover:bg-background/50"
                      onClick={() => removeTag.mutate(tag)}
                      aria-label={`删除标签 ${tag}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tagDraft.trim()) addTag.mutate(tagDraft.trim());
                }}
              >
                <Input
                  className="h-8"
                  placeholder="添加标签（回车确认）"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                />
                <Button size="sm" variant="outline" type="submit" disabled={!tagDraft.trim()}>
                  添加
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">来源（{d.sources.length}）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {d.sources.map((s) => {
                const url = telegramMessageUrl(s.chatId, s.messageId);
                return (
                  <div key={s.id} className="rounded-md border px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      {s.isPrimary && <Star className="size-3 fill-amber-400 text-amber-400" />}
                      <span className="font-medium">{s.chatTitle ?? `chat ${s.chatId}`}</span>
                      <span className="text-muted-foreground">#{s.messageId}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {s.via}
                      </Badge>
                      <span className="ml-auto text-muted-foreground">
                        {formatDateTime(s.messageDate)}
                      </span>
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="text-primary">
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    {s.caption && <div className="mt-1 text-muted-foreground">{s.caption}</div>}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">注解（{d.annotations.length}）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {d.annotations.map((a) => (
                <div key={a.id} className="rounded-md bg-muted px-3 py-2 text-xs">
                  <div className="text-muted-foreground">{formatDateTime(a.createdAt)}</div>
                  <div className="mt-0.5">{a.rawText}</div>
                </div>
              ))}
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (annotationDraft.trim()) annotate.mutate(annotationDraft.trim());
                }}
              >
                <Textarea
                  placeholder="写下你的备注（原文会完整保留）"
                  rows={2}
                  value={annotationDraft}
                  onChange={(e) => setAnnotationDraft(e.target.value)}
                />
                <Button size="sm" variant="outline" type="submit" disabled={!annotationDraft.trim()}>
                  保存注解
                </Button>
              </form>
            </CardContent>
          </Card>

          {d.jobs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">任务记录</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {d.jobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-2 text-xs">
                    <Badge
                      variant={job.status === 'succeeded' ? 'secondary' : 'destructive'}
                      className="text-[10px]"
                    >
                      {job.status}
                    </Badge>
                    <span className="font-medium">{job.type}</span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {job.error?.split('\n')[0] ?? ''}
                    </span>
                    <span className="text-muted-foreground">
                      {job.attempts}/{job.maxAttempts}
                    </span>
                    {job.status !== 'succeeded' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() =>
                          void api.retryJob(job.id).then(() => {
                            toast.success('已重新入队');
                            invalidate();
                          })
                        }
                      >
                        <RefreshCw className="size-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ForwardDialog
        mediaId={d.id}
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        onForwarded={invalidate}
      />
    </div>
  );
}
