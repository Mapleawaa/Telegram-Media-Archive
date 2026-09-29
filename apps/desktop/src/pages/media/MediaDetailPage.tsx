import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Forward,
  Lock,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { MediaDetail } from '@tma/shared';
import { ForwardDialog } from '@/components/media/ForwardDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  aiStatusLabel,
  categoryLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  forwardOriginLabel,
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

/** 折叠区（确定性字段 / 任务记录这类「要查但不常看」的信息） */
function Fold({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-border/70 bg-card/50 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[13px] font-medium">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        {title}
        {typeof count === 'number' ? (
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        ) : null}
      </summary>
      <div className="px-4 pb-3">{children}</div>
    </details>
  );
}

export function MediaDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const queryClient = useQueryClient();
  const [tagDraft, setTagDraft] = useState('');
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [forwardOpen, setForwardOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

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

  const enrich = useMutation({
    mutationFn: () => api.enrich(id),
    onSuccess: (res) => {
      toast.success(res.deduped ? '已在分析队列中' : '已加入 AI 分析队列');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '触发失败'),
  });

  const aiPolicy = useMutation({
    mutationFn: (skip: boolean) => api.setAiPolicy(id, { skip }),
    onSuccess: (_res, skip) => {
      toast.success(skip ? '已跳过 AI：转入待分类队列' : '已重新交回 AI 流程');
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '设置失败'),
  });

  // P5-1：标题锁定在用户手里，规则与 AI 都不再覆盖
  const setTitle = useMutation({
    mutationFn: (title: string) => api.setTitle(id, title),
    onSuccess: () => {
      setEditingTitle(false);
      toast.success('标题已更新（之后 AI / 规则不会再覆盖它）');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '更新失败'),
  });

  const setPrimary = useMutation({
    mutationFn: (messageId: number) => api.setPrimary(id, messageId),
    onSuccess: () => {
      toast.success('已设为主源');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '设置失败'),
  });

  const reparse = useMutation({
    mutationFn: () => api.reparse(id),
    onSuccess: (res) => {
      toast.success(res.changed ? '已按最新规则重新解析' : '规则结果无变化');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '重解析失败'),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteMedia(id),
    onSuccess: () => {
      toast.success('已移出媒体库（软删除，Telegram 里的原件不受影响）');
      void queryClient.invalidateQueries();
      void navigate('/library');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  });

  if (detail.isPending) {
    return (
      <div className="grid gap-6 px-7 py-6 lg:grid-cols-[minmax(300px,1fr)_minmax(0,1.2fr)]">
        <Skeleton className="aspect-2/3 rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="px-7 py-6">
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
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

  const chips = [
    d.category ? categoryLabel(d.category) : null,
    typeLabel(d.type),
    d.width && d.height ? `${d.width}×${d.height}` : null,
    formatBytes(d.sizeBytes),
    d.durationSec ? formatDuration(d.durationSec) : null,
    d.metadata?.year ? String(d.metadata.year) : null,
    d.metadata?.season ? `S${d.metadata.season}E${d.metadata.episode ?? '?'}` : null,
    d.metadata?.quality,
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="px-7 py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(300px,1fr)_minmax(0,1.2fr)]">
        {/* ---------- 左：海报区 + 动作 ---------- */}
        <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div className="relative overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10">
            {d.hasThumbnail ? (
              <img
                src={api.thumbnailUrl(d.id)}
                alt=""
                className="max-h-[62vh] w-full object-contain"
              />
            ) : (
              <div className="flex aspect-2/3 items-center justify-center text-xs text-muted-foreground">
                无缩略图
              </div>
            )}
            {d.isSensitive ? (
              <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white/90 backdrop-blur-sm">
                <Lock className="size-3" />
                敏感
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => setForwardOpen(true)}>
              <Send className="size-4" /> 转发到…
            </Button>
            {tgUrl && (
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <a href={tgUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> 在 Telegram 打开
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => enrich.mutate()}
              disabled={enrich.isPending}
            >
              <Sparkles className="size-4" /> AI 分析
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              title="重跑文件名解析（规则），不碰 AI 产物、不花 token"
              onClick={() => reparse.mutate()}
              disabled={reparse.isPending}
            >
              <RotateCcw className="size-4" /> 重新解析
            </Button>
          </div>

          <label
            className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs"
            title="跳过 AI：不进模型（不审核、不打标签），转入待分类队列"
          >
            <Switch
              checked={!d.aiSkip}
              disabled={aiPolicy.isPending}
              onCheckedChange={(checked) => aiPolicy.mutate(!checked)}
              aria-label={d.aiSkip ? '重新走 AI' : '跳过 AI'}
            />
            <span className="text-muted-foreground">
              {d.aiSkip ? '当前已跳过 AI（待人工分类）' : '走 AI 流程'}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {aiStatusLabel(d.aiStatus)}
            </span>
          </label>

          <Fold title="确定性字段">
            {d.metadata?.fileName && <CopyField label="文件名" value={d.metadata.fileName} />}
            <Field label="MIME" value={d.mime} />
            <Field label="来源标记" value={d.metadata?.source} />
            <Field label="编码" value={d.metadata?.codec} />
            <Field label="音轨" value={d.metadata?.audio} />
            <div className="my-1 border-t" />
            <CopyField label="file_unique_id" value={d.fileUniqueId} />
            {primary && (
              <CopyField label="chat / message" value={`${primary.chatId} / ${primary.messageId}`} />
            )}
          </Fold>
        </div>

        {/* ---------- 右：信息与操作 ---------- */}
        <div className="min-w-0 space-y-5">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              {editingTitle ? (
                <form
                  className="flex min-w-0 flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (titleDraft.trim()) setTitle.mutate(titleDraft.trim());
                  }}
                >
                  <Input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    placeholder="新的标题"
                  />
                  <Button size="sm" type="submit" disabled={!titleDraft.trim() || setTitle.isPending}>
                    保存
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setEditingTitle(false);
                      setTitleDraft('');
                    }}
                  >
                    取消
                  </Button>
                </form>
              ) : (
                <h1 className="min-w-0 flex-1 text-[26px] font-semibold leading-tight tracking-tight">
                  {d.title}
                </h1>
              )}
              {!editingTitle ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="mt-1 size-8 shrink-0"
                  title={d.titleSource === 'user' ? '已手动改过标题（AI/规则不会再覆盖）' : '手动改标题'}
                  onClick={() => {
                    setTitleDraft(d.title);
                    setEditingTitle(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
              ) : null}
              {d.isSensitive ? (
                <Badge variant="destructive" className="mt-1 shrink-0 text-[10px]">
                  敏感
                </Badge>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="tabular-nums">#{d.id}</span>
              {chips.map((c) => (
                <span key={c} className="rounded-full bg-muted px-2 py-0.5">
                  {c}
                </span>
              ))}
            </div>
          </div>

          {d.metadata?.summary && (
            <section className="rounded-xl border border-border/70 bg-card/50 p-4">
              <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium">
                <Sparkles className="size-3.5 text-primary" />
                AI 摘要
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {d.metadata.extractedBy ?? '—'}
                </span>
              </div>
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                {d.metadata.summary}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-border/70 bg-card/50 p-4">
            <div className="mb-2 text-[13px] font-medium">标签</div>
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
              className="mt-3 flex gap-2"
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
          </section>

          <section className="rounded-xl border border-border/70 bg-card/50 p-4">
            <div className="mb-2 text-[13px] font-medium">来源（{d.sources.length}）</div>
            <div className="space-y-2">
              {d.sources.map((s) => {
                const url = telegramMessageUrl(s.chatId, s.messageId);
                return (
                  <div key={s.id} className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
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
                      {!s.isPrimary && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 shrink-0 px-2 text-[10px]"
                          title="设为主源：决定缩略图与转发的默认来源"
                          onClick={() => setPrimary.mutate(s.id)}
                          disabled={setPrimary.isPending}
                        >
                          设为主源
                        </Button>
                      )}
                    </div>
                    {s.caption && <div className="mt-1 text-muted-foreground">{s.caption}</div>}
                    {s.forward && (
                      <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                        <Forward className="size-3" />
                        <span>
                          转发自{forwardOriginLabel(s.forward.originType)}：
                          {[
                            s.forward.chatTitle,
                            s.forward.senderName,
                            s.forward.chatUsername && `@${s.forward.chatUsername}`,
                          ]
                            .filter(Boolean)
                            .join(' / ') || '未知'}
                          {s.forward.chatId != null ? `（${s.forward.chatId}）` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card/50 p-4">
            <div className="mb-2 text-[13px] font-medium">注解（{d.annotations.length}）</div>
            <div className="space-y-2">
              {d.annotations.map((a) => (
                <div key={a.id} className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
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
            </div>
          </section>

          {d.jobs.length > 0 && (
            <Fold title="任务记录" count={d.jobs.length}>
              <div className="space-y-1.5">
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
                        className={cn('h-6 px-2')}
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
              </div>
            </Fold>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span>
              播放仍在 Telegram：<Link to="/library" className="text-primary">返回媒体库</Link>
            </span>
            <span className="ml-auto flex items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-destructive">确认移出媒体库？</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="size-3" /> 确认删除
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmDelete(false)}>
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-muted-foreground"
                  title="软删除：列表不再显示，Telegram 里的原件不受影响"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3" /> 移出媒体库
                </Button>
              )}
            </span>
          </div>
        </div>
      </div>

      <ForwardDialog
        mediaId={d.id}
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        onForwarded={invalidate}
        sources={d.sources}
        albumCount={d.albumCount}
      />
    </div>
  );
}
