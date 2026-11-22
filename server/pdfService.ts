import fs from 'fs';
import path from 'path';
import { extractText } from 'unpdf';
import {
  EXTRACTED_DIR,
  UPLOADS_DIR,
  type StoredLegalDocument,
  listStoredDocuments,
} from './store.ts';

export interface ExtractedPdfData {
  totalPages: number;
  pages: string[];
}

export interface PdfSearchMatch {
  docId: string;
  title: string;
  category: string;
  note: string;
  pageNumber: number;
  excerpt: string;
  score: number;
}

export function resolveSafeUploadPath(storedFileName: string): string {
  const safeName = path.basename(storedFileName);
  const resolved = path.resolve(UPLOADS_DIR, safeName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('INVALID_FILE_PATH');
  }
  return resolved;
}

export function resolveSafeExtractedPath(docId: string): string {
  const safeId = path.basename(docId).replace(/[^a-zA-Z0-9_-]/g, '');
  const resolved = path.resolve(EXTRACTED_DIR, `${safeId}.json`);
  if (!resolved.startsWith(EXTRACTED_DIR + path.sep)) {
    throw new Error('INVALID_FILE_PATH');
  }
  return resolved;
}

export async function verifyPdfMagicBytes(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, 1024, 0);
    if (bytesRead < 5) return false;
    const head = buffer.subarray(0, bytesRead).toString('latin1');
    return head.includes('%PDF-');
  } finally {
    await handle.close();
  }
}

export async function extractAndIndexPdf(
  docId: string,
  diskPath: string
): Promise<{ pageCount: number; extractedChars: number; indexed: boolean }> {
  try {
    const fileBuffer = await fs.promises.readFile(diskPath);
    const result = await extractText(new Uint8Array(fileBuffer), { mergePages: false });
    const rawPages = Array.isArray(result.text) ? result.text : [String(result.text ?? '')];
    const pages = rawPages.map((p) =>
      String(p ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const totalPages = typeof result.totalPages === 'number' && result.totalPages > 0
      ? result.totalPages
      : pages.length;
    const extractedChars = pages.reduce((sum, p) => sum + p.length, 0);

    const extractedPath = resolveSafeExtractedPath(docId);
    const payload: ExtractedPdfData = { totalPages, pages };
    await fs.promises.writeFile(extractedPath, JSON.stringify(payload), 'utf8');

    return {
      pageCount: totalPages,
      extractedChars,
      indexed: true,
    };
  } catch (err) {
    console.warn(`[PDF Index] Matn ajratishda ogohlantirish (${docId}):`, err);
    return {
      pageCount: 0,
      extractedChars: 0,
      indexed: true,
    };
  }
}

export async function deletePdfFiles(doc: StoredLegalDocument): Promise<void> {
  try {
    const uploadPath = resolveSafeUploadPath(doc.storedFileName);
    if (fs.existsSync(uploadPath)) {
      await fs.promises.unlink(uploadPath);
    }
  } catch (err) {
    console.warn('[PDF Delete] Faylni o‘chirishda xatolik:', err);
  }
  try {
    const extractedPath = resolveSafeExtractedPath(doc.id);
    if (fs.existsSync(extractedPath)) {
      await fs.promises.unlink(extractedPath);
    }
  } catch (err) {
    console.warn('[PDF Delete] Indeksni o‘chirishda xatolik:', err);
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
      // Add root prefix for agglutinative Uzbek suffixes (if long word)
      if (tok.length >= 6) {
        tokens.add(tok.slice(0, Math.max(4, tok.length - 3)));
      }
    }
  }
  return Array.from(tokens);
}

export async function searchRelevantPdfExcerpts(query: string): Promise<{
  matches: PdfSearchMatch[];
  catalogSummary: string;
  scannedDocs: StoredLegalDocument[];
}> {
  const docs = listStoredDocuments();
  if (docs.length === 0) {
    return { matches: [], catalogSummary: '', scannedDocs: [] };
  }

  const catalogLines = docs.map(
    (d, i) =>
      `${i + 1}. "${d.title}" (Soha: ${d.category}${d.note ? `, Izoh: ${d.note}` : ''}, Sahifalar: ${d.pageCount || 'nomaʼlum'})`
  );
  const catalogSummary = catalogLines.join('\n');

  const queryTokens = tokenizeQuery(query);
  const matches: PdfSearchMatch[] = [];
  const scannedDocs: StoredLegalDocument[] = [];

  for (const doc of docs) {
    if (doc.extractedChars < 150) {
      scannedDocs.push(doc);
    }

    const extractedPath = resolveSafeExtractedPath(doc.id);
    if (!fs.existsSync(extractedPath)) continue;

    let parsed: ExtractedPdfData;
    try {
      const raw = await fs.promises.readFile(extractedPath, 'utf8');
      parsed = JSON.parse(raw) as ExtractedPdfData;
    } catch {
      continue;
    }

    const titleNorm = normalizeUzbekText(`${doc.title} ${doc.category} ${doc.note}`);
    let titleBoost = 0;
    for (const tok of queryTokens) {
      if (titleNorm.includes(tok)) titleBoost += 4;
    }

    const docPageMatches: PdfSearchMatch[] = [];

    for (let idx = 0; idx < parsed.pages.length; idx++) {
      const pageText = parsed.pages[idx];
      if (!pageText || pageText.length < 30) continue;

      const pageNorm = normalizeUzbekText(pageText);
      let score = titleBoost;
      let hitCount = 0;
      let firstHitIdx = -1;

      for (const tok of queryTokens) {
        const pos = pageNorm.indexOf(tok);
        if (pos !== -1) {
          hitCount++;
          // Numbers (like article numbers) get extra weight
          score += /^\d+$/.test(tok) ? 8 : 3;
          if (firstHitIdx === -1) firstHitIdx = pos;
        }
      }

      if (hitCount > 0 || (queryTokens.length === 0 && idx < 2)) {
        // Build focused excerpt up to 1800 chars around first match
        let excerpt = pageText;
        if (pageText.length > 1800) {
          const approxRatio = firstHitIdx > 0 ? firstHitIdx / Math.max(1, pageNorm.length) : 0;
          const center = Math.floor(approxRatio * pageText.length);
          const start = Math.max(0, center - 600);
          const end = Math.min(pageText.length, start + 1800);
          excerpt = (start > 0 ? '... ' : '') + pageText.slice(start, end) + (end < pageText.length ? ' ...' : '');
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

    // Keep top 3 pages per document so one large document doesn't crowd out others
    docPageMatches.sort((a, b) => b.score - a.score);
    matches.push(...docPageMatches.slice(0, 3));
  }

  matches.sort((a, b) => b.score - a.score);

  // If nothing matched strongly via keywords but docs exist with text, provide intro excerpts from top 2 docs
  if (matches.length === 0) {
    for (const doc of docs.slice(0, 2)) {
      const extractedPath = resolveSafeExtractedPath(doc.id);
      if (!fs.existsSync(extractedPath)) continue;
      try {
        const raw = await fs.promises.readFile(extractedPath, 'utf8');
        const parsed = JSON.parse(raw) as ExtractedPdfData;
        const firstNonEmpty = parsed.pages.findIndex((p) => p && p.length > 40);
        if (firstNonEmpty !== -1) {
          matches.push({
            docId: doc.id,
            title: doc.title,
            category: doc.category,
            note: doc.note,
            pageNumber: firstNonEmpty + 1,
            excerpt: parsed.pages[firstNonEmpty].slice(0, 1500),
            score: 1,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  // Cap total characters at 18,000
  const selected: PdfSearchMatch[] = [];
  let charBudget = 18000;
  for (const m of matches) {
    if (charBudget - m.excerpt.length < 0 && selected.length > 0) break;
    selected.push(m);
    charBudget -= m.excerpt.length;
    if (selected.length >= 8) break;
  }

  return {
    matches: selected,
    catalogSummary,
    scannedDocs: scannedDocs.slice(0, 2),
  };
}
