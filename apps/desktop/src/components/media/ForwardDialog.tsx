import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SETTING_KEYS, type SourceItem } from '@tma/shared';
import { api } from '@/lib/api';

interface ForwardDialogProps {
  mediaId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onForwarded?: () => void;
  /** 多来源时让用户挑要转发哪一条（P5-3 / B13）；缺省用主源 */
  sources?: SourceItem[];
  /** 相册组大小（>1 时提供整组转发） */
  albumCount?: number;
}

const MANUAL = '__manual__';

export function ForwardDialog({
  mediaId,
  open,
  onOpenChange,
  onForwarded,
  sources,
  albumCount,
}: ForwardDialogProps) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, enabled: open });
  const chats = useQuery({ queryKey: ['chats'], queryFn: api.chats, enabled: open });

  const [target, setTarget] = useState('');
  const [pickChat, setPickChat] = useState<string>(MANUAL);
  const [mode, setMode] = useState<'forward' | 'copy'>('copy');
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [wholeAlbum, setWholeAlbum] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    const t = settings.data.settings[SETTING_KEYS.forwardTargetChatId];
    const m = settings.data.settings[SETTING_KEYS.forwardMode];
    if (typeof t === 'number' || typeof t === 'string') setTarget(String(t));
    if (m === 'forward' || m === 'copy') setMode(m);
  }, [settings.data]);

  // 默认选中主源
  useEffect(() => {
    if (!sources || sources.length === 0) return;
    setSourceId(sources.find((s) => s.isPrimary)?.id ?? sources[0]!.id);
  }, [sources]);

  const seenChats = (chats.data?.items ?? []).filter((c) => !c.isArchive);
  const chatList = seenChats.length > 0;

  const forward = useMutation({
    mutationFn: () => {
      const manualTarget = pickChat === MANUAL && target.trim() ? Number(target.trim()) : undefined;
      const listTarget = pickChat !== MANUAL ? Number(pickChat) : undefined;
      return api.forward(mediaId, {
        targetChatId: manualTarget ?? listTarget,
        mode,
        sourceMessageId: sources && sources.length > 1 ? (sourceId ?? undefined) : undefined,
        album: (albumCount ?? 1) > 1 ? wholeAlbum : undefined,
      });
    },
    onSuccess: (res) => {
      if (res.album) {
        toast.success(`整组转发完成：${res.count} 项 → Telegram`);
      } else {
        toast.success(
          `已${res.mode === 'forward' ? '转发' : '复制'}到 Telegram（消息 #${res.messageId}）`,
        );
      }
      onOpenChange(false);
      onForwarded?.();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '转发失败');
    },
  });

  const albumAvailable = (albumCount ?? 1) > 1;
  const multiSource = (sources?.length ?? 0) > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>转发到 Telegram</DialogTitle>
          <DialogDescription>
            目标会话需要先与 Bot 有过交互。留空则使用设置里的默认目标；「见过的 chat」来自 Bot
            收到过的消息。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>目标会话</Label>
            {chatList ? (
              <Select value={pickChat} onValueChange={setPickChat}>
                <SelectTrigger>
                  <SelectValue placeholder="从见过的 chat 里选" />
                </SelectTrigger>
                <SelectContent>
                  {seenChats.map((c) => (
                    <SelectItem key={c.chatId} value={String(c.chatId)}>
                      {c.chatTitle ?? c.chatId} · {c.chatType ?? 'chat'} · {c.count} 条
                    </SelectItem>
                  ))}
                  <SelectItem value={MANUAL}>手动输入 chat ID…</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Bot 还没见过其他 chat，请手动输入目标 ID。
              </p>
            )}
            {(!chatList || pickChat === MANUAL) && (
              <Input
                id="target-chat"
                placeholder="例如 123456789 或 -100xxxxxxxxxx"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            )}
          </div>

          {multiSource && sources ? (
            <div className="space-y-1.5">
              <Label>来源消息（{sources.length} 条）</Label>
              <Select
                value={String(sourceId ?? '')}
                onValueChange={(v) => setSourceId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择来源" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.isPrimary ? '★ ' : ''}
                      {s.chatTitle ?? `chat ${s.chatId}`} · #{s.messageId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {albumAvailable ? (
            <label className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Switch checked={wholeAlbum} onCheckedChange={setWholeAlbum} />
              <span className="space-y-0.5">
                <span className="block text-[13px] font-medium">整组转发（相册 {albumCount} 项）</span>
                <span className="block text-[11px] text-muted-foreground">
                  按相册内顺序逐条发送，保持原有排列。
                </span>
              </span>
            </label>
          ) : null}

          <div className="space-y-1.5">
            <Label>方式</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'forward' | 'copy')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">复制（不带转发来源头）</SelectItem>
                <SelectItem value="forward">转发（保留转发来源）</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => forward.mutate()}
            disabled={
              forward.isPending ||
              (pickChat === MANUAL && !target.trim()) ||
              (pickChat !== MANUAL && !pickChat)
            }
          >
            {forward.isPending
              ? '发送中…'
              : wholeAlbum && albumAvailable
                ? `整组发送（${albumCount} 项）`
                : '发送'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
