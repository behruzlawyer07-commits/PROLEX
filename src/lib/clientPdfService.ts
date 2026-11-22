import { extractText } from 'unpdf';
import type { LegalDocumentMeta, PdfExcerptPayload } from '../types/sherlex';

export async function verifyPdfMagicBytesClient(file: File): Promise<boolean> {
  try {
    const slice = file.slice(0, 1024);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 5) return false;
    let head = '';
    for (let i = 0; i < bytes.length; i++) {
      head += String.fromCharCode(bytes[i]);
    }
    return head.includes('%PDF-');
  } catch {
    return false;
  }
}

export async function extractPdfTextClient(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ pageCount: number; pages: string[]; extractedChars: number }> {
  try {
    onProgress?.(20);
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.(50);

    const result = await extractText(new Uint8Array(arrayBuffer), { mergePages: false });
    onProgress?.(85);

    const rawPages = Array.isArray(result.text)
      ? result.text
      : [String(result.text ?? '')];

    const pages = rawPages.map((p) =>
      String(p ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const totalPages =
      typeof result.totalPages === 'number' && result.totalPages > 0
        ? result.totalPages
        : pages.length;
    const extractedChars = pages.reduce((sum, p) => sum + p.length, 0);

    onProgress?.(95);
    return {
      pageCount: totalPages,
      pages,
      extractedChars,
    };
  } catch (err) {
    console.warn('[PROLEX PDF Client] Matn ajratishda ogohlantirish:', err);
    onProgress?.(90);
    return {
      pageCount: 0,
      pages: [],
      extractedChars: 0,
    };
  }
}

function normalizeUzbekText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’`ʻʼ]/g, "'")
    .replace(/[^a-z0-9а-яёўқғҳ'\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'va',
  'yoki',
  'bilan',
  'uchun',
  'ham',
  'esa',
  'bu',
  'shu',
  'o',
  'u',
  'bir',
  'bo',
  'yicha',
  'haqida',
  'qilish',
  'etish',
  'kerak',
  'nima',
  'qanday',
  'qaysi',
  'holatda',
  'kazus',
  'boyicha',
]);

function tokenizeQuery(query: string): string[] {
  const normalized = normalizeUzbekText(query);
  const rawTokens = normalized.split(' ').filter(Boolean);
  const tokens = new Set<string>();
  for (const tok of rawTokens) {
    if (tok.length >= 2 && !STOP_WORDS.has(tok)) {
      tokens.add(tok);
      if (tok.length >= 6) {
        tokens.add(tok.slice(0, Math.max(4, tok.length - 3)));
      }
    }
  }
  return Array.from(tokens);
}

interface ScoredMatch extends PdfExcerptPayload {
  score: number;
}

export async function searchRelevantPdfExcerptsClient(
  query: string,
  docs: LegalDocumentMeta[],
  getPages: (docId: string) => Promise<string[] | null>
): Promise<{
  matches: PdfExcerptPayload[];
  catalogSummary: string;
}> {
  if (docs.length === 0) {
    return { matches: [], catalogSummary: '' };
  }

  const catalogSummary = docs
    .map(
      (d, i) =>
        `${i + 1}. "${d.title}" (Soha: ${d.category}${d.note ? `, Izoh: ${d.note}` : ''}, Sahifalar: ${d.pageCount || 'nomaʼlum'})`
    )
    .join('\n');

  const queryTokens = tokenizeQuery(query);
  const matches: ScoredMatch[] = [];

  for (const doc of docs) {
    const pages = await getPages(doc.id);
    if (!pages || pages.length === 0) continue;

    const titleNorm = normalizeUzbekText(`${doc.title} ${doc.category} ${doc.note}`);
    let titleBoost = 0;
    for (const tok of queryTokens) {
      if (titleNorm.includes(tok)) titleBoost += 4;
    }

    const docPageMatches: ScoredMatch[] = [];

    for (let idx = 0; idx < pages.length; idx++) {
      const pageText = pages[idx];
      if (!pageText || pageText.length < 30) continue;

      const pageNorm = normalizeUzbekText(pageText);
      let score = titleBoost;
      let hitCount = 0;
      let firstHitIdx = -1;

      for (const tok of queryTokens) {
        const pos = pageNorm.indexOf(tok);
        if (pos !== -1) {
          hitCount++;
          score += /^\d+$/.test(tok) ? 8 : 3;
          if (firstHitIdx === -1) firstHitIdx = pos;
        }
      }

      if (hitCount > 0 || (queryTokens.length === 0 && idx < 2)) {
        let excerpt = pageText;
        if (pageText.length > 1800) {
          const approxRatio =
            firstHitIdx > 0 ? firstHitIdx / Math.max(1, pageNorm.length) : 0;
          const center = Math.floor(approxRatio * pageText.length);
          const start = Math.max(0, center - 600);
          const end = Math.min(pageText.length, start + 1800);
          excerpt =
            (start > 0 ? '... ' : '') +
            pageText.slice(start, end) +
            (end < pageText.length ? ' ...' : '');
        }

        docPageMatches.push({
          docId: doc.id,
          title: doc.title,
          category: doc.category,
          note: doc.note,
          pageNumber: idx + 1,
          excerpt,
          score: score + hitCount * 2,
        });
      }
    }

    docPageMatches.sort((a, b) => b.score - a.score);
    matches.push(...docPageMatches.slice(0, 3));
  }

  matches.sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    for (const doc of docs.slice(0, 2)) {
      const pages = await getPages(doc.id);
      if (!pages) continue;
      const firstNonEmpty = pages.findIndex((p) => p && p.length > 40);
      if (firstNonEmpty !== -1) {
        matches.push({
          docId: doc.id,
          title: doc.title,
          category: doc.category,
          note: doc.note,
          pageNumber: firstNonEmpty + 1,
          excerpt: pages[firstNonEmpty].slice(0, 1500),
          score: 1,
        });
      }
    }
  }

  const selected: PdfExcerptPayload[] = [];
  let charBudget = 16000;
  for (const m of matches) {
    if (charBudget - m.excerpt.length < 0 && selected.length > 0) break;
    selected.push({
      docId: m.docId,
      title: m.title,
      category: m.category,
      note: m.note,
      pageNumber: m.pageNumber,
      excerpt: m.excerpt,
    });
    charBudget -= m.excerpt.length;
    if (selected.length >= 8) break;
  }

  return {
    matches: selected,
    catalogSummary,
  };
}
