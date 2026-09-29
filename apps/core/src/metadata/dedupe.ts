import { createHash } from 'node:crypto';

const EXT_RE = /\.[a-z0-9]{2,4}$/i;
const BRACKET_JUNK_RE = /[[(【（][^[\]()（）【】]*[)\]）】]/g;

export function normalizeFilenameForDedupe(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(EXT_RE, '')
    .replace(BRACKET_JUNK_RE, ' ')
    .replace(/[._\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DedupeKeyInput {
  fileName?: string | null;
  size: number;
  durationSec?: number | null;
  fileUniqueId: string;
}

/**
 * 二级去重键（一级是 file_unique_id）。
 * 没有文件名时（照片等）**不参与二级去重**：退回以 file_unique_id 占位保证唯一，
 * 否则「同名+同大小」会把两张不同照片错误合并。
 */
export function buildDedupeKey(input: DedupeKeyInput): string {
  const normalized = normalizeFilenameForDedupe(input.fileName ?? '');
  if (!normalized) return `nouid:${input.fileUniqueId}`;
  return createHash('sha256')
    .update(`${normalized}|${input.size}|${input.durationSec ?? ''}`)
    .digest('hex');
}
