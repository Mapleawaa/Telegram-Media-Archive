import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { SETTING_KEYS } from '@tma/shared';
import { Badge } from '@/components/ui/badge';
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
  const caps = useQuery({ queryKey: ['ai-capabilities'], queryFn: api.aiCapabilities });

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
    onSuccess: (res) => toast.success(`搜索索引已重建：${res.count} 项，${res.tookMs} ms（新回填 ${res.tagsAdded} 个标签）`),
  });

  const reindexVectors = useMutation({
    mutationFn: api.reindexEmbeddings,
    onSuccess: (res) => toast.success(`已入队 ${res.enqueued}/${res.total} 条向量化任务`),
    onError: (err) => toast.error(err instanceof Error ? err.message : '入队失败'),
  });

  const capRows = [
    { key: 'chat', label: '文本（Chat）', env: 'AI_CHAT_MODEL' },
    { key: 'vision', label: '视觉（Vision）', env: 'AI_VLM_MODEL' },
    { key: 'embed', label: '向量（Embedding）', env: 'AI_EMBED_MODEL' },
  ] as const;

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
          <CardTitle className="text-sm">AI 能力（各能力可分别配置模型与服务商）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {capRows.map((row) => {
            const status = caps.data?.[row.key];
            return (
              <div key={row.key} className="flex items-center gap-2 text-xs">
                <span className="w-32 text-muted-foreground">{row.label}</span>
                {status?.enabled ? (
                  <>
                    <Badge variant="secondary" className="text-[10px]">已启用</Badge>
                    <span className="font-mono">{status.model}</span>
                    <span className="truncate text-muted-foreground" title={status.baseUrl ?? ''}>
                      {status.baseUrl}
                    </span>
                  </>
                ) : (
                  <>
                    <Badge variant="outline" className="text-[10px]">未启用</Badge>
                    <span className="text-muted-foreground">
                      在 .env 设置 <code className="font-mono">{row.env}</code>
                      （可用 AI_{row.key.toUpperCase()}_BASE_URL / _API_KEY 指定不同服务商）
                    </span>
                  </>
                )}
              </div>
            );
          })}
          <Separator />
          <div className="flex items-center gap-2 text-xs">
            <span className="w-32 text-muted-foreground">向量库（sqlite-vec）</span>
            {caps.data?.vector.available ? (
              <>
                <Badge variant="secondary" className="text-[10px]">就绪</Badge>
                <span>
                  {caps.data.vector.dim} 维 · 已向量化 {caps.data.vector.embeddedCount} 条
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">尚未建立（配置 Embedding 后自动创建）</span>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => reindexVectors.mutate()}
              disabled={reindexVectors.isPending || !caps.data?.embed.enabled}
            >
              {reindexVectors.isPending ? '入队中…' : '重建向量索引'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              内容未变化的媒体会走缓存不重复计费；维度变化时自动重建向量表。
            </span>
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
