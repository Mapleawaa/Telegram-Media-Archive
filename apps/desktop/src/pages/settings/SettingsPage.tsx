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
import { Switch } from '@/components/ui/switch';
import { api, getCoreUrl, setCoreUrl } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { usePrivacyStore } from '@/stores/privacy';
import { useAppearanceStore } from '@/stores/appearance';
import { COVER_MODES, useUiStore } from '@/stores/ui';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const caps = useQuery({ queryKey: ['ai-capabilities'], queryFn: api.aiCapabilities });
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sourcesForward });

  const privacyEnabled = usePrivacyStore((s) => s.enabled);
  const setPrivacy = usePrivacyStore((s) => s.setEnabled);
  const font = useAppearanceStore((s) => s.font);
  const setFont = useAppearanceStore((s) => s.setFont);
  const coverMode = useUiStore((s) => s.coverMode);
  const setCoverMode = useUiStore((s) => s.setCoverMode);
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

  const consolidate = useMutation({
    mutationFn: api.consolidateTags,
    onSuccess: (res) => toast.success(`已入队 ${res.enqueued}/${res.total} 条标签压缩任务`),
    onError: (err) => toast.error(err instanceof Error ? err.message : '入队失败'),
  });

  const reparseAll = useMutation({
    mutationFn: api.reparseAll,
    onSuccess: (res) =>
      toast.success(
        `规则重解析完成：${res.changed}/${res.total} 条有变化（标题改写 ${res.titleChanged}，${res.tookMs} ms）`,
      ),
    onError: (err) => toast.error(err instanceof Error ? err.message : '重解析失败'),
  });

  const clearThumbs = useMutation({
    mutationFn: api.clearThumbnails,
    onSuccess: (res) => toast.success(`已清理 ${res.removed} 个缩略图缓存文件`),
    onError: (err) => toast.error(err instanceof Error ? err.message : '清理失败'),
  });

  const toggleSource = useMutation({
    mutationFn: ({ key, skip }: { key: string; skip: boolean }) => {
      const current = new Set(sources.data?.skipSources ?? []);
      if (skip) current.add(key);
      else current.delete(key);
      return api.patchSetting(SETTING_KEYS.aiSkipSources, [...current]);
    },
    onSuccess: (_res, vars) => {
      toast.success(vars.skip ? '该来源不再进入 AI，直接进待分类' : '该来源恢复走 AI');
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '保存失败'),
  });

  const SOURCE_TYPE_LABEL: Record<string, string> = {
    channel: '频道',
    chat: '群组',
    user: '用户',
    name: '隐藏用户名',
  };

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
          <CardTitle className="text-sm">来源与 AI 策略</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            关闭某个来源的开关后，来自它的内容<span className="text-foreground">不进模型</span>
            （不审核、不打标签），直接进入 Inbox「待分类」由你手工归类。适合会被外部 AI
            内容审核拒答的收藏。
          </p>
          {sources.isPending && <div className="text-xs text-muted-foreground">加载中…</div>}
          {sources.data && sources.data.items.length === 0 && (
            <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              还没有观察到转发来源。从别的频道/群转发一条媒体到归档群后，这里会出现它。
            </div>
          )}
          <div className="space-y-1.5">
            {sources.data?.items.map((item) => {
              const skipped = sources.data.skipSources.includes(item.key);
              const label = item.title ?? item.name ?? item.username ?? item.key;
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
                >
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {SOURCE_TYPE_LABEL[item.type] ?? item.type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{label}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {item.key} · {item.count} 条
                      {item.skippedCount > 0 ? ` · 已跳过 ${item.skippedCount}` : ''} ·{' '}
                      {formatRelative(item.lastSeenAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={
                        skipped ? 'text-[11px] text-amber-600' : 'text-[11px] text-muted-foreground'
                      }
                    >
                      {skipped ? '跳过 AI' : '走 AI'}
                    </span>
                    <Switch
                      checked={!skipped}
                      disabled={toggleSource.isPending}
                      onCheckedChange={(checked) => toggleSource.mutate({ key: item.key, skip: !checked })}
                      aria-label={`${label} 是否走 AI`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            说明：Telegram 的转发来源分四种。若某条「转发自群」但原发送者未隐藏，来源会记成
            <span className="font-mono"> user:&lt;id&gt;</span> 而非群——此时可到该媒体详情页用「跳过 AI」逐个处理。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">外观与隐私</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">正文字体</Label>
            <div className="flex gap-1 rounded-lg border p-0.5">
              {(
                [
                  { value: 'wenkai' as const, label: '霞鹜文楷' },
                  { value: 'ui' as const, label: 'Geist' },
                ]
              ).map((o) => (
                <Button
                  key={o.value}
                  size="sm"
                  variant={font === o.value ? 'secondary' : 'ghost'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => setFont(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">封面排列</Label>
            <div className="flex gap-1 rounded-lg border p-0.5">
              {COVER_MODES.map((m) => (
                <Button
                  key={m.value}
                  size="sm"
                  variant={coverMode === m.value ? 'secondary' : 'ghost'}
                  className="h-7 flex-1 text-xs"
                  title={m.hint}
                  onClick={() => setCoverMode(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              竖屏 = 2:3 裁切；方形 = 1:1 裁切；原始比例 = 不裁切、高低错落。
            </p>
          </div>

          <Separator />

          <label className="flex items-start gap-3">
            <Switch
              checked={privacyEnabled}
              onCheckedChange={setPrivacy}
              aria-label="隐私模式"
            />
            <span className="space-y-0.5">
              <span className="block text-[13px] font-medium">隐私模式</span>
              <span className="block text-[11px] leading-relaxed text-muted-foreground">
                开启后，敏感内容（人工标记，或归入成人分类/命中成人标签）在首页、媒体库、搜索中
                <strong>默认隐藏</strong>；页面顶部会出现提示条，可「临时显示」（只在本次会话有效）。
                Inbox 待分类队列不受影响——那里正需要看到它们来归类。
              </span>
            </span>
          </label>
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
          <Button
            variant="outline"
            onClick={() => consolidate.mutate()}
            disabled={consolidate.isPending}
          >
            {consolidate.isPending ? '入队中…' : '压缩标签（AI 只看标签）'}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            让 AI 只依据标签列表做归并/去冗余（不读内容）；用户标签永不被删除或合并。
          </p>
          <Button
            variant="outline"
            onClick={() => reparseAll.mutate()}
            disabled={reparseAll.isPending}
          >
            {reparseAll.isPending ? '重解析中…' : '按最新规则重解析全部'}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            只重跑确定性规则（不碰 AI 产物、不花 token）；规则升级后用它让存量数据跟上。
          </p>
          <Button
            variant="outline"
            onClick={() => clearThumbs.mutate()}
            disabled={clearThumbs.isPending}
          >
            {clearThumbs.isPending ? '清理中…' : '清空缩略图缓存'}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            缩略图是派生数据，删了会按需从 Telegram 重新下载；磁盘紧张时再用。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
