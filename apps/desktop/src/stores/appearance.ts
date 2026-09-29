/**
 * 外观偏好（本地、即时生效）：
 *   - 主题（浅/深/跟随系统）交给 next-themes（写 <html class="dark">，sonner 也读它）
 *   - 正文字体在这里：`ui`（Geist，拉丁字形好）或 `wenkai`（霞鹜文楷，中文更软）
 *
 * 只放「本机显示偏好」——不进库、不上服务端（架构原则：前端只存 UI 偏好）。
 */
import { create } from 'zustand';

export type FontChoice = 'ui' | 'wenkai';

const FONT_KEY = 'tma.font';

function readFont(): FontChoice {
  const raw = localStorage.getItem(FONT_KEY);
  return raw === 'wenkai' || raw === 'ui' ? raw : 'wenkai';
}

function applyFont(font: FontChoice): void {
  document.documentElement.dataset.font = font;
}

interface AppearanceState {
  font: FontChoice;
  setFont: (font: FontChoice) => void;
}

export const useAppearanceStore = create<AppearanceState>((set) => {
  const initial = readFont();
  applyFont(initial);
  return {
    font: initial,
    setFont: (font) => {
      localStorage.setItem(FONT_KEY, font);
      applyFont(font);
      set({ font });
    },
  };
});
