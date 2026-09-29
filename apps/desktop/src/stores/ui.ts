import { create } from 'zustand';

/** 封面排列模式：
 *  - portrait：全竖屏（2:3 裁切铺满）—— 影院海报感，整齐
 *  - square  ：方形（1:1 裁切铺满）—— 规则排列，适合混合内容
 *  - natural ：原始比例（按媒体真实宽高比，不裁切）—— 高低错落的瀑布式浏览
 */
export type CoverMode = 'portrait' | 'square' | 'natural';

export const COVER_MODES: { value: CoverMode; label: string; hint: string }[] = [
  { value: 'portrait', label: '竖屏', hint: '全部按 2:3 竖版裁切，影院海报感' },
  { value: 'square', label: '方形', hint: '全部按 1:1 裁切，规则整齐' },
  { value: 'natural', label: '原始比例', hint: '按媒体真实比例不裁切，高低错落' },
];

const COVER_KEY = 'tma.coverMode';
const VIEW_KEY = 'tma.viewMode';
const SIDEBAR_KEY = 'tma.sidebarCollapsed';

function readCover(): CoverMode {
  const raw = localStorage.getItem(COVER_KEY);
  return raw === 'portrait' || raw === 'square' || raw === 'natural' ? raw : 'portrait';
}

interface UiState {
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;
  coverMode: CoverMode;
  setCoverMode: (mode: CoverMode) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  viewMode: (localStorage.getItem(VIEW_KEY) as 'grid' | 'list') ?? 'grid',
  setViewMode: (viewMode) => {
    localStorage.setItem(VIEW_KEY, viewMode);
    set({ viewMode });
  },
  coverMode: readCover(),
  setCoverMode: (coverMode) => {
    localStorage.setItem(COVER_KEY, coverMode);
    set({ coverMode });
  },
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === '1',
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      return { sidebarCollapsed: next };
    }),
}));
