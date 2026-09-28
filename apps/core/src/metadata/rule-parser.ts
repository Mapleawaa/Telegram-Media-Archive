export interface ParsedFilename {
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  quality?: string;
  source?: string;
  codec?: string;
  audio?: string;
}

const QUALITY_RE = /\b(2160p|1440p|1080p|720p|576p|480p|4K|8K)\b/i;
const SOURCE_RE =
  /\b(WEB[-.]?DL|WEB[-.]?Rip|WEB|Blu-?ray|BDRip|BRRip|REMUX|HDTV|DVDRip|HDRip|HDCAM)\b/i;
const CODEC_RE = /\b(H\.?265|H\.?264|HEVC|x265|x264|AVC|AV1|VP9)\b/i;
const AUDIO_RE =
  /\b(DDP\+?5\.1|DD\+?5\.1|DDP5\.1|DD5\.1|AC3|EAC3|DTS[-.]?HD(?:\.?MA)?|DTS|TrueHD|Atmos|AAC|FLAC|Opus|MP3)\b/i;
const SEASON_EPISODE_RE = /(?:\b|[^a-z0-9])(?:[Ss](\d{1,2})[Ee](\d{1,3})|(\d{1,2})x(\d{2,3}))(?![a-z0-9])/;
const YEAR_RE = /(?:\b|[^0-9])((?:19|20)\d{2})(?![0-9pP])/g;

const AV_EXT_RE = /\.[A-Za-z0-9]{2,4}$/;
const BRACKET_JUNK_RE = /[[(【（][^[\]()（）【】]*[)\]）】]/g;
const SEP_RE = /[._\s\-]+/g;

const QUALITY_CANON: Record<string, string> = { '4k': '2160p', '8k': '4320p' };

const SOURCE_CANON: Record<string, string> = {
  webdl: 'WEB-DL',
  webrip: 'WEBRip',
  web: 'WEB',
  bluray: 'BluRay',
  bdrip: 'BDRip',
  brrip: 'BRRip',
  remux: 'REMUX',
  hdtv: 'HDTV',
  dvdrip: 'DVDRip',
  hdrip: 'HDRip',
  hdcam: 'HDCAM',
};

const CODEC_CANON: Record<string, string> = {
  h265: 'H.265',
  x265: 'H.265',
  hevc: 'H.265',
  h264: 'H.264',
  x264: 'H.264',
  avc: 'H.264',
  av1: 'AV1',
  vp9: 'VP9',
};

const AUDIO_CANON: Record<string, string> = {
  'ddp+5.1': 'DDP5.1',
  'dd+5.1': 'DDP5.1',
  truehd: 'TrueHD',
  atmos: 'Atmos',
};

function canonicalQuality(raw: string): string {
  const lower = raw.toLowerCase();
  return QUALITY_CANON[lower] ?? lower;
}

function canonicalSource(raw: string): string {
  const key = raw.toLowerCase().replace(/[.\-]/g, '');
  return SOURCE_CANON[key] ?? raw.toUpperCase();
}

function canonicalCodec(raw: string): string {
  const key = raw.toLowerCase().replace(/[.\-]/g, '');
  return CODEC_CANON[key] ?? raw.toUpperCase();
}

function canonicalAudio(raw: string): string {
  const upper = raw.toUpperCase();
  return AUDIO_CANON[upper.toLowerCase()] ?? upper;
}

function cleanedTitle(candidate: string): string | undefined {
  const title = candidate
    .replace(BRACKET_JUNK_RE, ' ')
    .replace(SEP_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return title.length > 0 ? title : undefined;
}

function lastYearIndexBefore(base: string, limit: number): { year: number; index: number } | undefined {
  let result: { year: number; index: number } | undefined;
  for (const m of base.matchAll(YEAR_RE)) {
    if (m.index === undefined || m.index >= limit) break;
    result = { year: Number(m[1]), index: m.index };
  }
  return result;
}

export interface CaptionEntity {
  type?: string;
  offset?: number;
  length?: number;
}

/**
 * 从附言提取 hashtag 标签：优先用 Telegram 的 hashtag entity（offset 为 UTF-16 单元，
 * 与 JS slice 一致），无 entity 时用正则兜底。
 */
export function extractHashtags(caption?: string, entities?: unknown): string[] {
  const tags = new Set<string>();
  if (caption && Array.isArray(entities)) {
    for (const raw of entities) {
      const ent = raw as CaptionEntity;
      if (
        ent.type === 'hashtag' &&
        typeof ent.offset === 'number' &&
        typeof ent.length === 'number'
      ) {
        const text = caption.slice(ent.offset, ent.offset + ent.length).replace(/^#/, '');
        if (text) tags.add(text);
      }
    }
  }
  if (tags.size === 0 && caption) {
    for (const m of caption.matchAll(/#([^\s#@]+)/gu)) {
      if (m[1]) tags.add(m[1]);
    }
  }
  return [...tags].filter((t) => t.length > 0 && t.length <= 64);
}

export function parseFilename(fileName: string): ParsedFilename {
  const base = fileName.replace(AV_EXT_RE, '');
  const parsed: ParsedFilename = {};
  let cut = base.length;

  const takeMatch = (re: RegExp, assign: (text: string) => void): void => {
    const m = re.exec(base);
    if (!m || m.index === undefined) return;
    assign(m[0]);
    cut = Math.min(cut, m.index);
  };

  takeMatch(QUALITY_RE, (t) => {
    parsed.quality = canonicalQuality(t);
  });
  takeMatch(SOURCE_RE, (t) => {
    parsed.source = canonicalSource(t);
  });
  takeMatch(CODEC_RE, (t) => {
    parsed.codec = canonicalCodec(t);
  });
  takeMatch(AUDIO_RE, (t) => {
    parsed.audio = canonicalAudio(t);
  });

  const se = SEASON_EPISODE_RE.exec(base);
  if (se && se.index !== undefined) {
    if (se[1] !== undefined && se[2] !== undefined) {
      parsed.season = Number(se[1]);
      parsed.episode = Number(se[2]);
    } else if (se[3] !== undefined && se[4] !== undefined) {
      parsed.season = Number(se[3]);
      parsed.episode = Number(se[4]);
    }
    cut = Math.min(cut, se.index);
  }

  // 片名可能自带年份（如 Blade Runner 2049），取元数据前最后一个年份候选
  const year = lastYearIndexBefore(base, cut);
  if (year && year.index > 0) {
    parsed.year = year.year;
    cut = Math.min(cut, year.index);
  }

  parsed.title = cleanedTitle(base.slice(0, cut));
  return parsed;
}
