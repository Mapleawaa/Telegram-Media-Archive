import {
  Inbox,
  LayoutDashboard,
  Library,
  Rss,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { queryClient } from '@/lib/queryClient';
import { useConnectionStore } from '@/stores/connection';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/library', label: '媒体库', icon: Library },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/ai', label: 'AI 活动', icon: Sparkles },
  { to: '/sources', label: '来源', icon: Rss },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

export function AppShell() {
  const online = useConnectionStore((s) => s.online);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-52 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Library className="size-4" />
          </div>
          <div className="text-sm font-semibold">Media Archive</div>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
          <span
            className={cn(
              'size-2 rounded-full',
              online ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
          {online ? 'Core 已连接' : 'Core 未连接'}
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
