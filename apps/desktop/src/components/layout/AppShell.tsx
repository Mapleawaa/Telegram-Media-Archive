import {
  Inbox,
  LayoutGrid,
  Library,
  Moon,
  Rss,
  Search,
  Settings,
  Sparkles,
  Sun,
  MonitorSmartphone,
  Type,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { queryClient } from '@/lib/queryClient';
import { useAppearanceStore } from '@/stores/appearance';
import { useConnectionStore } from '@/stores/connection';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: '首页', icon: LayoutGrid, end: true },
  { to: '/library', label: '媒体库', icon: Library },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/ai', label: 'AI 活动', icon: Sparkles },
  { to: '/sources', label: '来源', icon: Rss },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

const THEME_CYCLE = ['system', 'light', 'dark'] as const;

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = (theme ?? 'system') as (typeof THEME_CYCLE)[number];
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]!;
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : MonitorSmartphone;
  const label = current === 'light' ? '浅色' : current === 'dark' ? '深色' : '跟随系统';

  return (
    <Button
      size="sm"
      variant="ghost"
      title={`主题：${label}（点击切换为${
        next === 'light' ? '浅色' : next === 'dark' ? '深色' : '跟随系统'
      }）`}
      className="h-7 w-full justify-start gap-2 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(next)}
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  );
}

function FontToggle() {
  const font = useAppearanceStore((s) => s.font);
  const setFont = useAppearanceStore((s) => s.setFont);
  const isWenkai = font === 'wenkai';

  return (
    <Button
      size="sm"
      variant="ghost"
      title={isWenkai ? '字体：霞鹜文楷（点击换回 Geist）' : '字体：Geist（点击换为霞鹜文楷）'}
      className="h-7 w-full justify-start gap-2 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
      onClick={() => setFont(isWenkai ? 'ui' : 'wenkai')}
    >
      <Type className="size-3.5" />
      {isWenkai ? '霞鹜文楷' : 'Geist'}
    </Button>
  );
}

export function AppShell() {
  const online = useConnectionStore((s) => s.online);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center gap-2.5 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Library className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">Media Archive</div>
            <div className="text-[10px] text-muted-foreground">Telegram 媒体库</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <item.icon className="size-4" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-sidebar-border p-2">
          <ThemeToggle />
          <FontToggle />
          <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn('size-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')}
            />
            {online ? 'Core 已连接' : 'Core 未连接'}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!online && (
          <div className="flex items-center justify-between gap-4 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
            <span>Core 未连接——正在自动重连，界面显示的可能不是最新数据。</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void queryClient.invalidateQueries()}
            >
              重试
            </Button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
