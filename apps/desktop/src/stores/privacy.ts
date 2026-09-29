/**
 * 隐私模式（P4-6 / U4）：
 *   开启后，敏感内容（`isSensitive`，来自人工标记或成人分类/标签）在首页、媒体库、搜索里**默认隐藏**；
 *   顶部会出现一条提示条，可「临时显示」——**只在本次会话有效**，重开应用仍回到隐藏。
 *
 * 纯前端显示偏好（不改数据、不落库）——架构原则：前端只存 UI 偏好。
 */
import { create } from 'zustand';
import type { MediaListItem } from '@tma/shared';

const KEY = 'tma.privacyMode';

interface PrivacyState {
  /** 隐私模式总开关（持久） */
  enabled: boolean;
  /** 本次会话的临时放行（不持久） */
  revealed: boolean;
  setEnabled: (v: boolean) => void;
  revealTemporarily: () => void;
  hideAgain: () => void;
}

export const usePrivacyStore = create<PrivacyState>((set) => ({
  enabled: localStorage.getItem(KEY) === '1',
  revealed: false,
  setEnabled: (enabled) => {
    localStorage.setItem(KEY, enabled ? '1' : '0');
    set({ enabled, revealed: false });
  },
  revealTemporarily: () => set({ revealed: true }),
  hideAgain: () => set({ revealed: false }),
}));

/** 当前是否应当隐藏敏感内容 */
export function useSensitiveHidden(): boolean {
  const enabled = usePrivacyStore((s) => s.enabled);
  const revealed = usePrivacyStore((s) => s.revealed);
  return enabled && !revealed;
}

/** 按隐私模式过滤列表，并返回被隐藏的条数 */
export function filterByPrivacy<T extends Pick<MediaListItem, 'isSensitive'>>(
  items: readonly T[],
  hidden: boolean,
): { items: T[]; hiddenCount: number } {
  if (!hidden) return { items: [...items], hiddenCount: 0 };
  const visible = items.filter((i) => !i.isSensitive);
  return { items: visible, hiddenCount: items.length - visible.length };
}
