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

export function buildDedupeKey(
  fileName: string | undefined,
  size: number,
  durationSec?: number | null,
): string {
  const normalized = normalizeFilenameForDedupe(fileName ?? '');
  return createHash('sha256')
    .update(`${normalized}|${size}|${durationSec ?? ''}`)
    .digest('hex');
}
