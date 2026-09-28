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
import { SETTING_KEYS } from '@tma/shared';
import { api } from '@/lib/api';

interface ForwardDialogProps {
  mediaId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onForwarded?: () => void;
}

export function ForwardDialog({ mediaId, open, onOpenChange, onForwarded }: ForwardDialogProps) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, enabled: open });
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<'forward' | 'copy'>('copy');

  useEffect(() => {
    if (!settings.data) return;
    const t = settings.data.settings[SETTING_KEYS.forwardTargetChatId];
    const m = settings.data.settings[SETTING_KEYS.forwardMode];
    if (typeof t === 'number' || typeof t === 'string') setTarget(String(t));
    if (m === 'forward' || m === 'copy') setMode(m);
  }, [settings.data]);

  const forward = useMutation({
    mutationFn: () =>
      api.forward(mediaId, {
        targetChatId: target.trim() ? Number(target.trim()) : undefined,
        mode,
      }),
    onSuccess: (res) => {
      toast.success(`已${res.mode === 'forward' ? '转发' : '复制'}到 Telegram（消息 #${res.messageId}）`);
      onOpenChange(false);
      onForwarded?.();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '转发失败');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>转发到 Telegram</DialogTitle>
          <DialogDescription>
            目标会话需要先与 Bot 有过交互（例如私聊发过消息）。留空则使用设置里的默认目标。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="target-chat">目标 chat ID</Label>
            <Input
              id="target-chat"
              placeholder="例如 123456789 或 -100xxxxxxxxxx"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
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
          <Button onClick={() => forward.mutate()} disabled={forward.isPending}>
            {forward.isPending ? '发送中…' : '发送'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
