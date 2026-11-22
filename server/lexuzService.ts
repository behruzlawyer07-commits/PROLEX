import fs from 'fs';
import os from 'os';
import path from 'path';
import type { GroundingSource } from '../src/types/sherlex';

const LEXUZ_CACHE_DIR = path.join(os.tmpdir(), 'prolex-lexuz-cache');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_VERSION = 2;

export type CoreCodeKey =
  | 'KONST'
  | 'JK'
  | 'JPK'
  | 'FK1'
  | 'FK2'
  | 'FPK'
  | 'MJtK'
  | 'MSIYtK'
  | 'MK'
  | 'OK'
  | 'SK'
  | 'PROK'
  | 'KORR';

export interface CoreCodeSpec {
  key: CoreCodeKey;
  docId: string;
  officialName: string;
  url: string;
}

export const CORE_CODES: Record<CoreCodeKey, CoreCodeSpec> = {
  KONST: {
    key: 'KONST',
    docId: '6445145',
    officialName: "O'zbekiston Respublikasi Konstitutsiyasi (Yangi tahrir, 30.04.2023)",
    url: 'https://lex.uz/uz/docs/6445145',
  },
  JK: {
    key: 'JK',
    docId: '-111453',
    officialName: "O'zbekiston Respublikasining Jinoyat kodeksi",
    url: 'https://lex.uz/uz/docs/-111453',
  },
  JPK: {
    key: 'JPK',
    docId: '-111460',
    officialName: "O'zbekiston Respublikasining Jinoyat-protsessual kodeksi",
    url: 'https://lex.uz/uz/docs/-111460',
  },
  FK1: {
    key: 'FK1',
    docId: '111189',
    officialName: "O'zbekiston Respublikasining Fuqarolik kodeksi (birinchi qism)",
    url: 'https://lex.uz/uz/docs/111189',
  },
  FK2: {
    key: 'FK2',
    docId: '-180552',
    officialName: "O'zbekiston Respublikasining Fuqarolik kodeksi (ikkinchi qism)",
    url: 'https://lex.uz/uz/docs/-180552',
  },
  FPK: {
    key: 'FPK',
    docId: '3517337',
    officialName: "O'zbekiston Respublikasining Fuqarolik protsessual kodeksi",
    url: 'https://lex.uz/uz/docs/3517337',
  },
  MJtK: {
    key: 'MJtK',
    docId: '97664',
    officialName: "O'zbekiston Respublikasining Ma'muriy javobgarlik to'g'risidagi kodeksi",
    url: 'https://lex.uz/uz/docs/97664',
  },
  MSIYtK: {
    key: 'MSIYtK',
    docId: '3527353',
    officialName: "O'zbekiston Respublikasining Ma'muriy sud ishlarini yuritish to'g'risidagi kodeksi",
    url: 'https://lex.uz/uz/docs/3527353',
  },
  MK: {
    key: 'MK',
    docId: '6257288',
    officialName: "O'zbekiston Respublikasining Mehnat kodeksi (28.10.2022)",
    url: 'https://lex.uz/uz/docs/6257288',
  },
  OK: {
    key: 'OK',
    docId: '-104720',
    officialName: "O'zbekiston Respublikasining Oila kodeksi",
    url: 'https://lex.uz/uz/docs/-104720',
  },
  SK: {
    key: 'SK',
    docId: '4674902',
    officialName: "O'zbekiston Respublikasining Soliq kodeksi",
    url: 'https://lex.uz/uz/docs/4674902',
  },
  PROK: {
    key: 'PROK',
    docId: '-106197',
    officialName: '"Prokuratura to\'g\'risida"gi O\'zbekiston Respublikasi Qonuni (Yangi tahrir)',
    url: 'https://lex.uz/uz/docs/-106197',
  },
  KORR: {
    key: 'KORR',
    docId: '-3088008',
    officialName: '"Korrupsiyaga qarshi kurashish to\'g\'risida"gi O\'zbekiston Respublikasi Qonuni (O\'RQ-419)',
    url: 'https://lex.uz/uz/docs/-3088008',
  },
};

export interface ParsedArticle {
  number: string;
  header: string;
  text: string;
}

interface CachedLexDoc {
  version: number;
  docId: string;
  fetchedAt: number;
  articles: ParsedArticle[];
}

export interface LexUzContextResult {
  contextBlock: string;
  verifiedSources: GroundingSource[];
}

const memoryDocCache = new Map<string, CachedLexDoc>();

function ensureCacheDir(): boolean {
  try {
    fs.mkdirSync(LEXUZ_CACHE_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

const CYR_VOWELS = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'э', 'ю', 'я', 'ў', 'А', 'Е', 'Ё', 'И', 'О', 'У', 'Э', 'Ю', 'Я', 'Ў']);
const CYR_SOFT_START = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'э', 'ю', 'я', 'ў', 'ъ', 'ь', 'А', 'Е', 'Ё', 'И', 'О', 'У', 'Э', 'Ю', 'Я', 'Ў', 'Ъ', 'Ь']);

const CYR_TO_LAT_MAP: Record<string, string> = {
  А: 'A', а: 'a',
  Б: 'B', б: 'b',
  В: 'V', в: 'v',
  Г: 'G', г: 'g',
  Д: 'D', д: 'd',
  Ё: 'Yo', ё: 'yo',
  Ж: 'J', ж: 'j',
  З: 'Z', з: 'z',
  И: 'I', и: 'i',
  Й: 'Y', й: 'y',
  К: 'K', к: 'k',
  Л: 'L', л: 'l',
  М: 'M', м: 'm',
  Н: 'N', н: 'n',
  О: 'O', о: 'o',
  П: 'P', п: 'p',
  Р: 'R', р: 'r',
  С: 'S', с: 's',
  Т: 'T', т: 't',
  У: 'U', у: 'u',
  Ф: 'F', ф: 'f',
  Х: 'X', х: 'x',
  Ч: 'Ch', ч: 'ch',
  Ш: 'Sh', ш: 'sh',
  Ъ: "'", ъ: "'",
  Ь: '', ь: '',
  Э: 'E', э: 'e',
  Ю: 'Yu', ю: 'yu',
  Я: 'Ya', я: 'ya',
  Ў: "O'", ў: "o'",
  Қ: 'Q', қ: 'q',
  Ғ: "G'", ғ: "g'",
  Ҳ: 'H', ҳ: 'h',
};

export function cyrillicToLatinUz(text: string): string {
  // Fast exit if there are no Cyrillic characters
  if (!/[\u0400-\u04FF]/.test(text)) return text;

  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === 'Е' || ch === 'е') {
      const prev = i > 0 ? text[i - 1] : '';
      const isStart = !prev || !/[\u0400-\u04FFa-zA-Z0-9]/.test(prev) || CYR_SOFT_START.has(prev);
      if (isStart) {
        out += ch === 'Е' ? 'Ye' : 'ye';
      } else {
        out += ch === 'Е' ? 'E' : 'e';
      }
      continue;
    }
    if (ch === 'Ц' || ch === 'ц') {
      const prev = i > 0 ? text[i - 1] : '';
      if (prev && CYR_VOWELS.has(prev)) {
        out += ch === 'Ц' ? 'Ts' : 'ts';
      } else {
        out += ch === 'Ц' ? 'S' : 's';
      }
      continue;
    }
    out += CYR_TO_LAT_MAP[ch] ?? ch;
  }
  return out;
}

function cleanLexHtmlToText(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<div class="lx_elem3">[\s\S]*?<\/div><\/div>/gi, ' ')
    .replace(/<div class="COMMENT[\s\S]*?<\/div><\/div>/gi, ' ')
    .replace(/<sup>(\d+)<\/sup>/gi, '-$1')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  cleaned = decodeHtmlEntities(cleaned);
  cleaned = cyrillicToLatinUz(cleaned);

  // Strip Lex.uz system metadata / UI action labels
  cleaned = cleaned
    .replace(/\[\s*(?:OKOZ|OKОZ|TSZ|SPiT|LX)[^\]]*\]/gi, ' ')
    .replace(/Hujjatga taklif yuborish|Audioni tinglash|Hujjat elementidan havola olish|Oldingi tahrirga qarang\.?/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return cleaned;
}

function parseArticlesFromHtml(html: string): ParsedArticle[] {
  const bodyMarker = html.indexOf('id="divCont"');
  let relevantHtml = html;
  if (bodyMarker !== -1) {
    relevantHtml = html.slice(bodyMarker);
  }

  const plain = cleanLexHtmlToText(relevantHtml);
  const lines = plain
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(?:O['ʻ’]?zbekiston Respublikasining\s+)?(?:Qonuni|Kodeksi)$/i.test(l));

  const articles: ParsedArticle[] = [];
  const articleStartRegex = /^(\d+(?:-\d+)?)-modda\.?\s*(.*)$/i;

  let current: ParsedArticle | null = null;
  let bodyLines: string[] = [];

  for (const line of lines) {
    const match = line.match(articleStartRegex);
    if (match) {
      if (current && bodyLines.length > 0) {
        articles.push({
          ...current,
          text: bodyLines.join('\n').slice(0, 3400),
        });
      }
      current = {
        number: match[1],
        header: line,
        text: '',
      };
      bodyLines = [line];
    } else if (current) {
      if (/^(?:[IVXLC]+|\d+)\s+(?:BO['ʻ’]LIM|BOB)\b/i.test(line)) {
        if (bodyLines.length > 0) {
          articles.push({
            ...current,
            text: bodyLines.join('\n').slice(0, 3400),
          });
        }
        current = null;
        bodyLines = [];
      } else {
        if (current.header.endsWith('-modda.') || current.header.endsWith('-modda')) {
          current.header = `${current.header} ${line}`.slice(0, 140);
        }
        bodyLines.push(line);
      }
    }
  }

  if (current && bodyLines.length > 0) {
    articles.push({
      ...current,
      text: bodyLines.join('\n').slice(0, 3400),
    });
  }

  // Deduplicate keeping the longest (body over TOC) entry per article number
  const byNumber = new Map<string, ParsedArticle>();
  for (const art of articles) {
    const existing = byNumber.get(art.number);
    if (!existing || art.text.length > existing.text.length) {
      byNumber.set(art.number, art);
    }
  }

  const result = Array.from(byNumber.values());
  if (result.length > 0) {
    return result;
  }

  // Fallback for Supreme Court Plenum resolutions & Decrees (numbered points "1.", "2.", etc.)
  const pointChunks: ParsedArticle[] = [];
  const pointStartRegex = /^(\d{1,3})\.\s+(.+)$/;
  let currentPoint: ParsedArticle | null = null;
  let pointLines: string[] = [];

  for (const line of lines) {
    const pm = line.match(pointStartRegex);
    if (pm && Number(pm[1]) <= 120) {
      if (currentPoint && pointLines.length > 0) {
        pointChunks.push({
          ...currentPoint,
          text: pointLines.join('\n').slice(0, 2400),
        });
      }
      currentPoint = {
        number: `band-${pm[1]}`,
        header: line.slice(0, 140),
        text: '',
      };
      pointLines = [line];
    } else if (currentPoint) {
      pointLines.push(line);
    }
  }
  if (currentPoint && pointLines.length > 0) {
    pointChunks.push({
      ...currentPoint,
      text: pointLines.join('\n').slice(0, 2400),
    });
  }

  return pointChunks;
}

async function fetchLexDocById(docId: string): Promise<CachedLexDoc | null> {
  if (!/^-?\d+$/.test(docId)) return null;

  const mem = memoryDocCache.get(docId);
  if (
    mem &&
    mem.version === CACHE_VERSION &&
    Date.now() - mem.fetchedAt < CACHE_TTL_MS &&
    mem.articles.length > 0
  ) {
    return mem;
  }

  const canUseDisk = ensureCacheDir();
  const cachePath = path.join(LEXUZ_CACHE_DIR, `${docId}.json`);
  if (canUseDisk && fs.existsSync(cachePath)) {
    try {
      const raw = await fs.promises.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(raw) as CachedLexDoc;
      if (
        parsed.version === CACHE_VERSION &&
        Date.now() - parsed.fetchedAt < CACHE_TTL_MS &&
        Array.isArray(parsed.articles) &&
        parsed.articles.length > 0
      ) {
        memoryDocCache.set(docId, parsed);
        return parsed;
      }
    } catch {
      // refetch
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`https://lex.uz/uz/docs/${docId}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PROLEX-Legal-Assistant/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const html = await res.text();
    const articles = parseArticlesFromHtml(html);

    const cached: CachedLexDoc = {
      version: CACHE_VERSION,
      docId,
      fetchedAt: Date.now(),
      articles,
    };
    memoryDocCache.set(docId, cached);
    await fs.promises.writeFile(cachePath, JSON.stringify(cached), 'utf8').catch(() => {});
    return cached;
  } catch (err) {
    console.warn(`[Lex.uz Fetch] Hujjatni yuklashda ogohlantirish (${docId}):`, err);
    return null;
  }
}

function normalizeUz(text: string): string {
  return cyrillicToLatinUz(text)
    .toLowerCase()
    .replace(/[‘’`ʻʼ]/g, "'")
    .replace(/[^a-z0-9'\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinksFromSearchHtml(
  html: string,
  keywords: string[]
): Array<{ docId: string; title: string; url: string; score: number }> {
  const matches = [
    ...html.matchAll(/<a[^>]+href="(\/uz\/docs\/([-0-9]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi),
  ];

  const results: Array<{ docId: string; title: string; url: string; score: number }> = [];
  const seen = new Set<string>();

  for (const m of matches) {
    const docId = m[2];
    const rawTitle = m[3].replace(/<[^>]+>/g, ' ');
    const title = cyrillicToLatinUz(decodeHtmlEntities(rawTitle)).replace(/\s+/g, ' ').trim();
    if (!docId || !title || seen.has(docId)) continue;

    // Exclude individual court dockets and draft bills
    if (/^\d+-\d+-\d+\/\d+-sonli\s+(?:iqtisodiy\s+)?ish/i.test(title)) continue;
    if (/qonuni\s+loyihasi/i.test(title)) continue;

    seen.add(docId);
    const normTitle = normalizeUz(title);
    let score = 0;
    for (const kw of keywords) {
      if (normTitle.includes(kw)) score += 5;
    }
    if (/sud amaliyoti|sudlar tomonidan|plenum/i.test(title)) score += 6;
    if (/kodeksi|qonuni/i.test(title)) score += 2;

    results.push({
      docId,
      title,
      url: `https://lex.uz/uz/docs/${docId}`,
      score,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 6);
}

export interface LexSearchHit {
  docId: string;
  title: string;
  url: string;
  snippet?: string;
}

function isAllowedLexUzUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'lex.uz' && !host.endsWith('.lex.uz')) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function searchLexUzViaSerper(query: string): Promise<LexSearchHit[]> {
  const apiKey = (
    process.env.SERPER_API_KEY ??
    process.env.VITE_SERPER_API_KEY ??
    ''
  ).trim();
  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4200);
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `site:lex.uz ${query}`,
        num: 8,
        hl: 'uz',
        gl: 'uz',
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const payload = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    const organic = Array.isArray(payload.organic) ? payload.organic : [];
    const hits: LexSearchHit[] = [];
    const seenUrls = new Set<string>();

    for (const item of organic) {
      if (!item.link || !item.title) continue;
      const parsed = isAllowedLexUzUrl(item.link);
      if (!parsed) continue;

      // Normalize canonical Lex.uz URL
      const docMatch = parsed.pathname.match(/\/docs\/(-?\d+)/i);
      const docId = docMatch?.[1] ?? '';
      const canonicalUrl = docId
        ? `https://lex.uz/uz/docs/${docId}`
        : `https://${parsed.hostname}${parsed.pathname}`;

      const cleanTitle = cyrillicToLatinUz(item.title)
        .replace(/\s*\|\s*lex\.uz.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanTitle || seenUrls.has(canonicalUrl)) continue;
      if (/^\d+-\d+-\d+\/\d+-sonli\s+(?:iqtisodiy\s+)?ish/i.test(cleanTitle)) continue;
      if (/qonuni\s+loyihasi/i.test(cleanTitle)) continue;

      seenUrls.add(canonicalUrl);
      hits.push({
        docId,
        title: cleanTitle,
        url: canonicalUrl,
        snippet: item.snippet ? cyrillicToLatinUz(item.snippet).trim() : undefined,
      });
      if (hits.length >= 6) break;
    }

    return hits;
  } catch (err) {
    console.warn('[Serper Lex.uz] Qidiruvda ogohlantirish:', err);
    return [];
  }
}

export async function searchLexUzDocuments(query: string): Promise<LexSearchHit[]> {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) return [];

  const keywords = normalizeUz(cleanedQuery)
    .split(' ')
    .filter((w) => w.length >= 4)
    .map((w) => (w.length >= 6 ? w.slice(0, w.length - 2) : w));

  // Primary: Google site:lex.uz search via SERPER_API_KEY
  const serperHits = await searchLexUzViaSerper(cleanedQuery);
  const combined: LexSearchHit[] = [...serperHits];
  const seenUrls = new Set(combined.map((h) => h.url));

  if (combined.length >= 3) {
    return combined.slice(0, 6);
  }

  try {
    // Supplement/fallback: direct Lex.uz title & active search
    const titleUrl = `https://lex.uz/uz/search/all?searchtitle=${encodeURIComponent(cleanedQuery)}&statuses=1`;
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), 4500);
    const res1 = await fetch(titleUrl, {
      signal: controller1.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PROLEX-Legal-Assistant/1.0)' },
    });
    clearTimeout(timeout1);

    let directHits: Array<{ docId: string; title: string; url: string; score: number }> = [];
    if (res1.ok) {
      const html1 = await res1.text();
      directHits = extractLinksFromSearchHtml(html1, keywords);
    }

    if (directHits.length < 2 && combined.length < 2) {
      const fullUrl = `https://lex.uz/uz/search/all?query=${encodeURIComponent(cleanedQuery)}&statuses=1`;
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 4500);
      const res2 = await fetch(fullUrl, {
        signal: controller2.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PROLEX-Legal-Assistant/1.0)' },
      });
      clearTimeout(timeout2);

      if (res2.ok) {
        const html2 = await res2.text();
        const fullHits = extractLinksFromSearchHtml(html2, keywords);
        const seenIds = new Set(directHits.map((h) => h.docId));
        for (const fh of fullHits) {
          if (!seenIds.has(fh.docId)) {
            directHits.push(fh);
            seenIds.add(fh.docId);
          }
        }
      }
    }

    for (const dh of directHits) {
      if (!seenUrls.has(dh.url)) {
        seenUrls.add(dh.url);
        combined.push({ docId: dh.docId, title: dh.title, url: dh.url });
      }
    }

    return combined.slice(0, 6);
  } catch (err) {
    console.warn('[Lex.uz Search] Qidiruvda ogohlantirish:', err);
    return combined.slice(0, 6);
  }
}

export async function retrieveLexUzGroundings(params: {
  userPrompt: string;
  codesToCheck: CoreCodeKey[];
  suspectedArticles: string[];
  lexSearchQueries: string[];
}): Promise<LexUzContextResult> {
  const verifiedSources: GroundingSource[] = [];
  const seenSourceUrls = new Set<string>();
  const contextSections: string[] = [];

  const addSource = (title: string, url: string) => {
    if (seenSourceUrls.has(url)) return;
    seenSourceUrls.add(url);
    verifiedSources.push({ title, url });
  };

  const explicitArticles = new Set<string>(
    params.suspectedArticles.map((a) => a.replace(/[^0-9-]/g, '')).filter(Boolean)
  );
  for (const m of params.userPrompt.matchAll(/(\d+(?:-\d+)?)\s*-?\s*(?:modda|модда)/gi)) {
    explicitArticles.add(m[1]);
  }

  const queryKeywords = normalizeUz(params.userPrompt)
    .split(' ')
    .filter((w) => w.length >= 4)
    .map((w) => (w.length >= 6 ? w.slice(0, w.length - 2) : w));

  // Build search queries: include essence term + targeted Supreme Court Plenum query for rich Lex.uz coverage
  const rawQueries = params.lexSearchQueries.map((q) => q.trim()).filter(Boolean);
  if (rawQueries.length === 0) {
    rawQueries.push(params.userPrompt.slice(0, 90));
  }
  const searchQueries = [...rawQueries.slice(0, 2)];
  const hasPlenumQuery = searchQueries.some((q) => /plenum|oliy sud/i.test(q));
  if (!hasPlenumQuery && searchQueries[0]) {
    const shortTopic = searchQueries[0].split(/\s+/).slice(0, 3).join(' ');
    searchQueries.push(`${shortTopic} Oliy sud Plenumi qarori`);
  }

  // Fetch relevant Core Codes AND run Serper/Lex.uz search in parallel
  const uniqueCodes = Array.from(new Set(params.codesToCheck)).slice(0, 4);
  const [codeResults, searchHitGroups] = await Promise.all([
    Promise.all(
      uniqueCodes.map(async (codeKey) => {
        const spec = CORE_CODES[codeKey];
        if (!spec) return null;
        const doc = await fetchLexDocById(spec.docId);
        return { spec, doc };
      })
    ),
    Promise.all(searchQueries.slice(0, 3).map((q) => searchLexUzDocuments(q))),
  ]);

  let charBudget = 20000;

  for (const item of codeResults) {
    if (!item || !item.doc) continue;
    const { spec, doc } = item;
    addSource(spec.officialName, spec.url);

    const matchedArticles: Array<{ art: ParsedArticle; score: number }> = [];

    for (const art of doc.articles) {
      let score = 0;
      if (explicitArticles.has(art.number)) {
        score += 100;
      }
      const normText = normalizeUz(art.text);
      const normHeader = normalizeUz(art.header);
      for (const kw of queryKeywords) {
        if (normHeader.includes(kw)) score += 7;
        else if (normText.includes(kw)) score += 2;
      }
      if (score > 0) {
        matchedArticles.push({ art, score });
      }
    }

    matchedArticles.sort((a, b) => b.score - a.score);
    const topArticles = matchedArticles.slice(0, 7);
    const perArticleCap = topArticles.length > 4 ? 1500 : 2300;

    if (topArticles.length > 0 && charBudget > 500) {
      let section = `\n=== LEX.UZ RASMIY MATN: ${spec.officialName} (${spec.url}) ===\n`;
      for (const { art } of topArticles) {
        const snippet = art.text.slice(0, perArticleCap);
        if (section.length + snippet.length > charBudget) break;
        section += `\n${snippet}\n`;
      }
      charBudget -= section.length;
      contextSections.push(section);
    }
  }

  const flatHits: LexSearchHit[] = [];
  const seenFlatUrls = new Set<string>();
  for (const hit of searchHitGroups.flat()) {
    if (!seenFlatUrls.has(hit.url)) {
      seenFlatUrls.add(hit.url);
      flatHits.push(hit);
    }
  }
  // Prioritize Supreme Court Plenum resolutions and core laws
  flatHits.sort((a, b) => {
    const aPlenum = /plenum|oliy sud|sud amaliyoti/i.test(a.title) ? 0 : 1;
    const bPlenum = /plenum|oliy sud|sud amaliyoti/i.test(b.title) ? 0 : 1;
    return aPlenum - bPlenum;
  });

  if (flatHits.length > 0) {
    let searchSection = '\n=== LEX.UZ QIDIRUVDAN (SERPER site:lex.uz / LEX.UZ) TOPILGAN HUJJATLAR ===\n';
    for (const hit of flatHits.slice(0, 8)) {
      addSource(hit.title, hit.url);
      searchSection += `- ${hit.title} (${hit.url})${hit.snippet ? `\n  Qisqacha mazmun: ${hit.snippet}` : ''}\n`;
    }
    contextSections.push(searchSection);

    const priorityHits = flatHits
      .filter((h) => h.docId && !uniqueCodes.some((c) => CORE_CODES[c]?.docId === h.docId))
      .slice(0, 2);

    if (priorityHits.length > 0 && charBudget > 1200) {
      const extraDocs = await Promise.all(
        priorityHits.map(async (hit) => ({
          hit,
          doc: await fetchLexDocById(hit.docId),
        }))
      );

      for (const { hit, doc: extraDoc } of extraDocs) {
        if (!extraDoc || extraDoc.articles.length === 0 || charBudget <= 800) continue;
        const best = extraDoc.articles
          .map((art) => {
            const norm = normalizeUz(art.text);
            const score = queryKeywords.reduce(
              (acc, kw) => acc + (norm.includes(kw) ? 2 : 0),
              0
            );
            return { art, score };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        if (best.length > 0) {
          let extraText = `\n--- ${hit.title} (${hit.url}) ---\n`;
          for (const b of best) {
            const piece = `${b.art.text.slice(0, 1400)}\n`;
            if (extraText.length + piece.length > charBudget) break;
            extraText += piece;
          }
          charBudget -= extraText.length;
          contextSections.push(extraText);
        }
      }
    }
  }

  return {
    contextBlock: contextSections.join('\n'),
    verifiedSources: verifiedSources.slice(0, 10),
  };
}

export async function prewarmCoreCodes(): Promise<void> {
  const priorityKeys: CoreCodeKey[] = ['KONST', 'JK', 'JPK', 'FK1', 'MK', 'PROK'];
  await Promise.allSettled(
    priorityKeys.map((key) => fetchLexDocById(CORE_CODES[key].docId))
  );
}
