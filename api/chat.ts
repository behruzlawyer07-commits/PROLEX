import type { IncomingMessage, ServerResponse } from 'http';
import { generateLegalAnalysis } from '../server/geminiService';
import type { ChatApiRequest, PdfExcerptPayload } from '../src/types/sherlex';

interface VercelLikeRequest extends IncomingMessage {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (payload: unknown) => void;
}

function sendJson(res: VercelLikeResponse, statusCode: number, payload: unknown): void {
  if (typeof res.status === 'function') {
    const statusRes = res.status(statusCode);
    if (typeof statusRes?.json === 'function') {
      statusRes.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: VercelLikeRequest): Promise<Record<string, unknown> | null> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object' && req.body !== null) {
      return req.body as Record<string, unknown>;
    }
    return null;
  }

  return await new Promise<Record<string, unknown> | null>((resolve) => {
    const chunks: Buffer[] = [];
    let totalLen = 0;
    const MAX_BODY = 512 * 1024; // 512 KB

    req.on('data', (chunk: Buffer) => {
      totalLen += chunk.length;
      if (totalLen <= MAX_BODY) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (totalLen === 0 || totalLen > MAX_BODY) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

export async function executeChatRequest(
  rawBody: Record<string, unknown> | null
): Promise<{ status: number; payload: unknown }> {
  if (!rawBody) {
    return { status: 400, payload: { error: 'So‘rov tanasi noto‘g‘ri formatda.' } };
  }

  const body = rawBody as Partial<ChatApiRequest>;
  const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';

  if (!userPrompt) {
    return { status: 400, payload: { error: 'Savol yoki kazus matnini kiriting.' } };
  }
  if (userPrompt.length > 15000) {
    return { status: 400, payload: { error: 'Matn hajmi 15 000 belgidan oshmasligi kerak.' } };
  }

  const safeHistory = Array.isArray(body.history)
    ? body.history
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            Boolean(m) &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string'
        )
        .slice(-8)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 4000),
        }))
    : [];

  const safePdfMatches: PdfExcerptPayload[] = Array.isArray(body.pdfContext?.matches)
    ? body.pdfContext!.matches
        .filter(
          (m): m is PdfExcerptPayload =>
            Boolean(m) &&
            typeof m.title === 'string' &&
            typeof m.excerpt === 'string'
        )
        .slice(0, 8)
        .map((m) => ({
          docId: String(m.docId ?? '').slice(0, 80),
          title: m.title.slice(0, 180),
          category: String(m.category ?? '').slice(0, 80),
          note: String(m.note ?? '').slice(0, 200),
          pageNumber: Number(m.pageNumber) || 1,
          excerpt: m.excerpt.slice(0, 2200),
        }))
    : [];

  const safeCatalogSummary =
    typeof body.pdfContext?.catalogSummary === 'string'
      ? body.pdfContext.catalogSummary.slice(0, 4000)
      : '';

  try {
    const analysis = await generateLegalAnalysis({
      history: safeHistory,
      userPrompt,
      pdfContext: {
        catalogSummary: safeCatalogSummary,
        matches: safePdfMatches,
      },
    });
    return { status: 200, payload: analysis };
  } catch (err) {
    console.error('[PROLEX Chat API Error]:', err);
    const errMsg = err instanceof Error ? err.message : '';
    if (errMsg === 'MISSING_GEMINI_API_KEY') {
      return {
        status: 503,
        payload: {
          error:
            'Gemini API kaliti sozlanmagan. Iltimos, server muhitida (Vercel Environment Variables yoki Settings > Secrets) GEMINI_API_KEY qiymatini kiriting.',
        },
      };
    }
    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('PERMISSION_DENIED')) {
      return {
        status: 502,
        payload: {
          error:
            'Gemini API kaliti yaroqsiz yoki ruxsat etilmagan. Muhit o‘zgaruvchisidan kalitni tekshiring.',
        },
      };
    }
    if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
      return {
        status: 429,
        payload: {
          error:
            'Gemini API so‘rovlar kvotasi tugadi (429 RESOURCE_EXHAUSTED). Birozdan so‘ng qayta urinib ko‘ring yoki to‘lovli (billing-enabled) API kalitini ulang.',
        },
      };
    }
    if (
      errMsg.includes('503') ||
      errMsg.includes('UNAVAILABLE') ||
      errMsg.toLowerCase().includes('high demand')
    ) {
      return {
        status: 503,
        payload: {
          error:
            'AI xizmatida vaqtincha yuqori yuklama kuzatilmoqda (503). Iltimos, bir necha soniyadan so‘ng qayta yuborib ko‘ring.',
        },
      };
    }
    if (errMsg === 'EMPTY_MODEL_RESPONSE') {
      return {
        status: 502,
        payload: {
          error:
            'AI modelidan bo‘sh javob qaytdi. Iltimos, kazus yoki savolni aniqroq yozib qayta urinib ko‘ring.',
        },
      };
    }
    if (errMsg.startsWith('TIMEOUT_')) {
      return {
        status: 504,
        payload: {
          error:
            'So‘rovni qayta ishlash vaqti tugadi. Iltimos, savolni qayta yuborib ko‘ring.',
        },
      };
    }
    return {
      status: 502,
      payload: {
        error: 'Huquqiy tahlilni shakllantirishda AI xizmatida xatolik yuz berdi. Qayta urinib ko‘ring.',
      },
    };
  }
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Faqat POST so‘rovi qabul qilinadi.' });
    return;
  }

  const body = await readJsonBody(req);
  const result = await executeChatRequest(body);
  sendJson(res, result.status, result.payload);
}
