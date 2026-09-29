import {
  EyeOff,
  Inbox,
  LayoutGrid,
  Library,
  MonitorSmartphone,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Rss,
  Search,
  Settings,
  Sparkles,
  Sun,
  Type,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { useHotkeys } from '@/hooks/useHotkeys';
import { queryClient } from '@/lib/queryClient';
import { useAppearanceStore } from '@/stores/appearance';
import { useConnectionStore } from '@/stores/connection';
import { usePrivacyStore } from '@/stores/privacy';
import { useUiStore } from '@/stores/ui';
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

function FooterButton({
  icon: Icon,
  label,
  title,
  collapsed,
  onClick,
  active,
}: {
  icon: typeof Sun;
  label: string;
  title: string;
  collapsed: boolean;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      title={title}
      className={cn(
        'h-7 w-full justify-start gap-2 px-2 text-xs font-normal text-muted-foreground hover:text-foreground',
        collapsed && 'justify-center px-0',
        active && 'text-foreground',
      )}
      onClick={onClick}
    >
      <Icon className="size-3.5 shrink-0" />
      {collapsed ? null : label}
    </Button>
  );
}

export function AppShell() {
  useHotkeys();
  const online = useConnectionStore((s) => s.online);
  const { theme, setTheme } = useTheme();
  const font = useAppearanceStore((s) => s.font);
  const setFont = useAppearanceStore((s) => s.setFont);
  const privacyEnabled = usePrivacyStore((s) => s.enabled);
  const setPrivacy = usePrivacyStore((s) => s.setEnabled);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  const current = (theme ?? 'system') as (typeof THEME_CYCLE)[number];
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]!;
  const ThemeIcon = current === 'light' ? Sun : current === 'dark' ? Moon : MonitorSmartphone;
  const themeLabel = current === 'light' ? '浅色' : current === 'dark' ? '深色' : '跟随系统';
  const nextLabel = nextTheme === 'light' ? '浅色' : nextTheme === 'dark' ? '深色' : '跟随系统';
  const isWenkai = font === 'wenkai';

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        <div className={cn('flex h-16 items-center gap-2.5', collapsed ? 'justify-center px-0' : 'px-4')}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Library className="size-4" />
          </div>
          {collapsed ? null : (
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-tight">Media Archive</div>
              <div className="text-[10px] text-muted-foreground">Telegram 媒体库</div>
            </div>
          )}
        </div>

        <nav className={cn('flex-1 space-y-0.5 py-1', collapsed ? 'px-1.5' : 'px-2')}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center rounded-lg py-2 text-[13px] transition-colors',
                  collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {collapsed ? null : (
                    <span
                      className={cn(
                        'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  )}
                  <item.icon className="size-4 shrink-0" />
                  {collapsed ? null : item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className={cn('space-y-0.5 border-t border-sidebar-border p-2', collapsed && 'px-1.5')}>
          <FooterButton
            icon={ThemeIcon}
            label={themeLabel}
            title={`主题：${themeLabel}（点击切换为${nextLabel}）`}
            collapsed={collapsed}
            onClick={() => setTheme(nextTheme)}
          />
          <FooterButton
            icon={Type}
            label={isWenkai ? '霞鹜文楷' : 'Geist'}
            title={isWenkai ? '字体：霞鹜文楷（点击换回 Geist）' : '字体：Geist（点击换为霞鹜文楷）'}
            collapsed={collapsed}
            onClick={() => setFont(isWenkai ? 'ui' : 'wenkai')}
          />
          <FooterButton
            icon={EyeOff}
            label={privacyEnabled ? '隐私模式：开' : '隐私模式：关'}
            title={
              privacyEnabled
                ? '隐私模式已开启：敏感内容默认隐藏（点击关闭）'
                : '隐私模式已关闭：敏感内容照常显示（点击开启）'
            }
            collapsed={collapsed}
            active={privacyEnabled}
            onClick={() => setPrivacy(!privacyEnabled)}
          />
          <FooterButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label="收起侧栏"
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            collapsed={collapsed}
            onClick={toggleSidebar}
          />
          <div
            className={cn(
              'flex items-center gap-2 py-1.5 text-[11px] text-muted-foreground',
              collapsed ? 'justify-center px-0' : 'px-2',
            )}
            title={online ? 'Core 已连接' : 'Core 未连接'}
          >
            <span
              className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')}
            />
            {collapsed ? null : online ? 'Core 已连接' : 'Core 未连接'}
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
