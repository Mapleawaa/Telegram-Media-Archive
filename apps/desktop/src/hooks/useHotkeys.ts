import { useEffect } from 'react';
import { useNavigate } from 'react-router';

/**
 * 全局快捷键（P4-5）：
 *   `/`      跳到搜索并聚焦输入框
 *   `Esc`    返回上一页（输入框内/弹窗内不触发，交给它们自己处理）
 *
 * 用 Ctrl/⌘ 组合键让路，避免和浏览器/系统快捷键打架。
 */
export function useHotkeys(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if (e.key === '/' && !typing) {
        e.preventDefault();
        void navigate('/search');
        // 等路由渲染完再聚焦
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('[data-search-input]')?.focus();
        }, 80);
        return;
      }

      if (e.key === 'Escape' && !typing) {
        // 有历史才返回，避免把用户弹出应用
        if (window.history.length > 1) navigate(-1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
