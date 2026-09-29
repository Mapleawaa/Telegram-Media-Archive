import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImageOff, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CATEGORY_PRESETS, type MediaListItem } from '@tma/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { categoryLabel, formatBytes, typeLabel } from '@/lib/format';

interface ManualClassifyDialogProps {
  item: MediaListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManualClassifyDialog({ item, open, onOpenChange }: ManualClassifyDialogProps) {
  const queryClient = useQueryClient();
  const mediaId = item?.id ?? 0;

  const detail = useQuery({
    queryKey: ['media', mediaId],
    queryFn: () => api.mediaDetail(mediaId),
    enabled: open && mediaId > 0,
  });
  const topTags = useQuery({
    queryKey: ['tags', 'top', 'user'],
    queryFn: () => api.tagsTop('user', 10),
    enabled: open,
  });

  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sensitive, setSensitive] = useState(false);

  // 打开时初始化：附言 hashtag（规则标签）自动预填勾选
  useEffect(() => {
    if (!open) return;
    setTags(item?.tags ?? []);
    setDraft('');
    setCategory(null);
    setSensitive(false);
  }, [open, item?.id, item?.tags]);

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    setDraft('');
  };

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const classify = useMutation({
    mutationFn: () =>
      api.classify(mediaId, {
        tags,
        category: category ?? undefined,
        sensitive,
      }),
    onSuccess: (res) => {
      toast.success(
        `已完成分类：${res.tagsAdded} 个新标签${res.category ? ` · ${categoryLabel(res.category)}` : ''}${
          res.sensitive ? ' · 已标记敏感' : ''
        }`,
      );
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['media'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '分类失败'),
  });

  const primary = detail.data?.sources.find((s) => s.isPrimary) ?? detail.data?.sources[0];
  const forward = primary?.forward;
  const forwardText = forward
    ? [forward.chatTitle ?? forward.senderName ?? forward.chatUsername, forward.originType]
        .filter(Boolean)
        .join(' · ')
    : null;

  const suggestions = (topTags.data?.items ?? []).map((t) => t.tag).filter((t) => !tags.includes(t));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>手动分类</DialogTitle>
          <DialogDescription>
            这条内容命中「跳过 AI」来源，未进入任何模型。补上标签与分类即可归档。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="size-24 shrink-0 overflow-hidden rounded-md border bg-muted">
              {item?.hasThumbnail ? (
                <img src={api.thumbnailUrl(mediaId)} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <ImageOff className="size-5" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="truncate text-sm font-medium">{item?.title}</div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {item ? typeLabel(item.type) : ''}
                </Badge>
                {item && <span>{formatBytes(item.sizeBytes)}</span>}
                {item?.quality && <span>{item.quality}</span>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                来源：{forwardText ?? primary?.chatTitle ?? '—'}
              </div>
              {primary?.caption && (
                <div className="line-clamp-2 text-[11px] text-muted-foreground">
                  附言：{primary.caption}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              标签{tags.length > 0 && <span className="text-muted-foreground">（{tags.length}）</span>}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 && (
                <span className="text-[11px] text-muted-foreground">暂无标签，可从下方候选或自定义添加</span>
              )}
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                  {tag}
                  <button
                    className="rounded-full p-0.5 hover:bg-background/50"
                    onClick={() => removeTag(tag)}
                    aria-label={`移除标签 ${tag}`}
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
                addTag(draft);
              }}
            >
              <Input
                className="h-8"
                placeholder="自定义标签（回车添加）"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button size="sm" variant="outline" type="submit" disabled={!draft.trim()}>
                <Plus className="size-3.5" /> 添加
              </Button>
            </form>
          </div>

          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">历史常用标签</Label>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((tag) => (
                  <button key={tag} onClick={() => addTag(tag)}>
                    <Badge variant="outline" className="hover:bg-muted">
                      <Plus className="size-3" /> {tag}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">分类</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory((prev) => (prev === c ? null : c))}
                  className={
                    category === c
                      ? 'rounded-4xl border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground'
                      : 'rounded-4xl border px-2.5 py-0.5 text-xs hover:bg-muted'
                  }
                >
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="space-y-0.5">
              <Label htmlFor="sensitive-switch" className="text-xs">
                标记为敏感
              </Label>
              <p className="text-[10px] text-muted-foreground">
                供分类夹与隐私模式使用（P4 接入）
              </p>
            </div>
            <Switch id="sensitive-switch" checked={sensitive} onCheckedChange={setSensitive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => classify.mutate()} disabled={classify.isPending}>
            <Check className="size-4" />
            {classify.isPending ? '保存中…' : '完成分类'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
