export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

export function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN');
}

const TYPE_LABELS: Record<string, string> = {
  video: '视频',
  photo: '图片',
  audio: '音频',
  animation: '动图',
  document: '文档',
  other: '其他',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

const AI_STATUS_LABELS: Record<string, string> = {
  pending: '待分析',
  partial: '部分完成',
  done: '已分析',
  failed: '分析失败',
  skipped: '跳过',
  manual: '待分类',
};

export function aiStatusLabel(status: string): string {
  return AI_STATUS_LABELS[status] ?? status;
}

/** 分类体系展示名（六类 + 自定义回退原文） */
const CATEGORY_LABELS: Record<string, string> = {
  movie: '电影',
  series: '剧集',
  anime: '动漫',
  adult: '成人',
  gallery: '图集',
  game: '游戏',
  book: '图书',
  other: '其他',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

const FORWARD_ORIGIN_LABELS: Record<string, string> = {
  channel: '频道',
  chat: '群组',
  user: '用户',
  hidden_user: '隐藏用户名',
};

export function forwardOriginLabel(originType: string): string {
  return FORWARD_ORIGIN_LABELS[originType] ?? originType;
}

export function telegramMessageUrl(chatId: number, messageId: number): string | null {
  const raw = String(chatId);
  if (!raw.startsWith('-100')) return null;
  return `https://t.me/c/${raw.slice(4)}/${messageId}`;
}
