import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { SETTING_KEYS } from '@tma/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { api, getCoreUrl, setCoreUrl } from '@/lib/api';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const [coreUrl, setCoreUrlDraft] = useState(getCoreUrl());
  const [targetChat, setTargetChat] = useState('');
  const [mode, setMode] = useState<'forward' | 'copy'>('copy');
  const [initialized, setInitialized] = useState(false);

  if (settings.data && !initialized) {
    const t = settings.data.settings[SETTING_KEYS.forwardTargetChatId];
    const m = settings.data.settings[SETTING_KEYS.forwardMode];
    if (t !== undefined) setTargetChat(String(t));
    if (m === 'forward' || m === 'copy') setMode(m);
    setInitialized(true);
  }

  const saveSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => api.patchSetting(key, value),
    onSuccess: () => {
      toast.success('已保存');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '保存失败'),
  });

  const reindex = useMutation({
    mutationFn: api.reindexSearch,
    onSuccess: (res) => toast.success(`搜索索引已重建：${res.count} 项，${res.tookMs} ms`),
  });

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold">设置</h1>
        <p className="text-xs text-muted-foreground">凭证与密钥只存放于 Core 的 .env，不在界面中展示。</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">连接</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="core-url">Core 地址</Label>
            <div className="flex gap-2">
              <Input
                id="core-url"
                value={coreUrl}
                onChange={(e) => setCoreUrlDraft(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => {
                  setCoreUrl(coreUrl.trim());
                  void queryClient.invalidateQueries();
                  toast.success('已切换到新地址');
                }}
              >
                保存
              </Button>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <span className="text-muted-foreground">归档群 ID</span>
            <span className="font-mono">{settings.data?.archiveChatId ?? '—'}</span>
            <span className="text-muted-foreground">数据目录</span>
            <span className="truncate font-mono" title={settings.data?.dataDir}>
              {settings.data?.dataDir ?? '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">转发</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="forward-target">默认目标 chat ID</Label>
            <div className="flex gap-2">
              <Input
                id="forward-target"
                placeholder="你的私聊 ID 或群 ID"
                value={targetChat}
                onChange={(e) => setTargetChat(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() =>
                  saveSetting.mutate({
                    key: SETTING_KEYS.forwardTargetChatId,
                    value: targetChat.trim() ? Number(targetChat.trim()) : null,
                  })
                }
              >
                保存
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              给 Bot 私聊发一条消息，Core 日志里会出现你的 chat ID。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>默认方式</Label>
            <div className="flex gap-2">
              <Select value={mode} onValueChange={(v) => setMode(v as 'forward' | 'copy')}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="copy">复制（不带转发来源头）</SelectItem>
                  <SelectItem value="forward">转发（保留转发来源）</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => saveSetting.mutate({ key: SETTING_KEYS.forwardMode, value: mode })}
              >
                保存
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">维护</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Button variant="outline" onClick={() => reindex.mutate()} disabled={reindex.isPending}>
            {reindex.isPending ? '重建中…' : '重建搜索索引'}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            规则解析升级或怀疑索引漂移时使用；全量重写 media_search_doc 并同步 FTS。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
