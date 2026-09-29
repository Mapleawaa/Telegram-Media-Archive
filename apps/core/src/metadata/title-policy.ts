/**
 * 标题策略：判定「垃圾标题」（文件名残留/通用词/纯数字/内部 ID），
 * 供 AI 标题补位与视觉描述生成标题使用。
 */

const GENERIC_TITLE_RE =
  /^(video|videos|photo|photos|image|images|audio|document|documents|animation|file|files|img|pic|picture|media|movie|clip|untitled|未命名|新建|其他|other|unknown|none)$/i;

export function isJunkTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title.trim();
  if (t.length < 2) return true;
  if (/^[\d\s._\-–—]+$/.test(t)) return true;
  if (GENERIC_TITLE_RE.test(t)) return true;
  if (/^#\d+$/.test(t)) return true;
  // Telegram 内部 ID 串（如 2099396071722440550 0）：数字占比高且总长很长
  const digits = t.replace(/\D/g, '');
  if (digits.length >= 12) return true;
  return false;
}

/** 从视觉描述生成短标题的长度上限 */
export const MAX_DERIVED_TITLE = 28;

// 句中标点：优先在这些位置断句，避免「…身后黑」这种把词切一半的标题
const SOFT_BREAK_RE = /[，、；：,;:]/;

/**
 * 从视觉描述生成短标题：取首句，超长时**在句中标点处**断句。
 * （旧实现按 24 字硬切，真实数据出现「…白西装坐皮椅持杖，身后黑」这种半截标题）
 */
export function deriveTitleFromDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const firstSentence = (description.split(/[。！？!?\n]/)[0] ?? '').trim();
  if (firstSentence.length < 4) return undefined;
  if (firstSentence.length <= MAX_DERIVED_TITLE) return firstSentence;

  const window = firstSentence.slice(0, MAX_DERIVED_TITLE);
  let cut = -1;
  for (let i = window.length - 1; i > 0; i -= 1) {
    if (SOFT_BREAK_RE.test(window[i]!)) {
      cut = i;
      break;
    }
  }
  const title = cut > 0 ? window.slice(0, cut).trim() : `${window.trim()}…`;
  return title.length >= 4 ? title : undefined;
}

/** 清理规则标题中的推广尾巴/频道句柄（真实案例：「喵叽小糯 白丝 32Cosplay电报TG@yijiqwq」） */
export function cleanRuleTitle(title: string): string {
  return title
    .replace(/(电报)?\s*TG\s*[@：:]\s*\S+/gi, ' ')
    .replace(/t\.me\/\S+/gi, ' ')
    .replace(/@[A-Za-z0-9_]{4,}/g, ' ')
    .replace(/[\s\-_.,;|]+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BAD_AI_TITLE_RE = /(无法|不能|抱歉|拒绝|涉及|不当|未提供|暂无|不存在|不符合)/;

/** 是否像「模型拒答/说明句」——用于清理历史数据中已落库的坏标题 */
export function isBadAiTitleLike(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.trim();
  return BAD_AI_TITLE_RE.test(t) || t.length > 30;
}

/**
 * AI 给出的标题也需要校验：拒答句、说明性长句、垃圾词一律拒收。
 * （真实案例：模型把「图片涉及露骨色情内容，无法生成归档描述」当标题返回）
 */
export function sanitizeAiTitle(title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 30) return undefined;
  if (BAD_AI_TITLE_RE.test(t)) return undefined;
  if (isJunkTitle(t)) return undefined;
  return t;
}
