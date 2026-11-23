import type {
  AuthStatusResponse,
  ChatApiRequest,
  ChatApiResponse,
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
  LegalDocumentMeta,
  PdfExcerptPayload,
  UserPublic,
  UserStatus,
} from '../types/sherlex';
import {
  GeminiClientError,
  generateLegalAnalysisClient,
  hasClientGeminiKey,
} from './clientGeminiService';
import {
  extractPdfTextClient,
  searchRelevantPdfExcerptsClient,
  verifyPdfMagicBytesClient,
} from './clientPdfService';
import {
  appendSupabaseChatMessages,
  authenticateSupabaseUser,
  createSupabaseChat,
  createSupabaseUser,
  deleteSupabaseChat,
  deleteSupabaseDocument,
  deleteSupabaseUser,
  ensurePrimaryAdminInSupabase,
  getSupabaseChat,
  getSupabaseConfigError,
  getSupabaseDocumentPages,
  listSupabaseChats,
  listSupabaseDocuments,
  listSupabaseUsers,
  saveSupabaseDocument,
  updateOwnSupabasePassword,
  updateSupabaseAdminPassword,
  updateSupabaseUser,
  updateSupabaseUserStatus,
} from './supabaseService';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

// In-memory session map only (zero localStorage / zero sessionStorage)
const sessionUsersByToken = new Map<string, UserPublic>();

async function postStore<T>(
  action: string,
  payload: Record<string, unknown>,
  token?: string | null
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    res = await fetch('/api/store', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('Sessiya serveri bilan aloqa vaqti tugadi.', 504);
    }
    throw new ApiError('Sessiya serveri (/api/store) bilan aloqa o‘rnatib bo‘lmadi.', 0);
  }
  clearTimeout(timer);

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const errMsg =
      data && typeof data.error === 'string' && data.error
        ? data.error
        : `Server xatoligi (${res.status}).`;
    throw new ApiError(errMsg, res.status);
  }
  return (data ?? {}) as T;
}

function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildChatTitleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 54) return cleaned;
  return `${cleaned.slice(0, 51).trim()}...`;
}

async function resolveSupabaseSessionUser(token: string): Promise<UserPublic> {
  const cached = sessionUsersByToken.get(token);
  if (cached) return cached;

  try {
    const res = await postStore<{ user: UserPublic }>('getMe', {}, token);
    if (res?.user) {
      sessionUsersByToken.set(token, res.user);
      return res.user;
    }
  } catch {
    // fall through
  }
  throw new Error('UNAUTHORIZED');
}

function sleepClient(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postChatRequest(
  payload: ChatApiRequest,
  onStreamText?: (partialText: string) => void
): Promise<ChatApiResponse> {
  const retryDelaysMs = [400, 900];
  const timeoutMs = 120_000;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ApiError(
          'AI serveridan javob kutish vaqti tugadi (120 soniya). Iltimos, «Qayta urinish» tugmasini bosing.',
          504
        );
      }
      if (attempt < retryDelaysMs.length) {
        await sleepClient(retryDelaysMs[attempt]);
        continue;
      }
      throw new ApiError(
        'AI tahlil serveri (/api/chat) bilan tarmoq aloqasi o‘rnatib bo‘lmadi. «Qayta urinish» tugmasini bosing.',
        0
      );
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (res.ok && contentType.includes('text/event-stream') && res.body) {
      let accumulated = '';
      let donePayload: ChatApiResponse | null = null;
      let sseError: { status: number; error: string } | null = null;

      try {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;
            try {
              const evt = JSON.parse(jsonStr) as {
                type?: string;
                text?: string;
                payload?: ChatApiResponse;
                status?: number;
                error?: string;
              };
              if (evt.type === 'reset') {
                accumulated = '';
                if (onStreamText) onStreamText('');
              } else if (evt.type === 'delta' && typeof evt.text === 'string') {
                accumulated += evt.text;
                if (onStreamText) onStreamText(accumulated);
              } else if (evt.type === 'done' && evt.payload && typeof evt.payload.text === 'string') {
                donePayload = evt.payload;
                if (onStreamText) onStreamText(donePayload.text);
              } else if (evt.type === 'error') {
                sseError = {
                  status: typeof evt.status === 'number' ? evt.status : 502,
                  error:
                    typeof evt.error === 'string' && evt.error
                      ? evt.error
                      : 'AI tahlilida xatolik yuz berdi.',
                };
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }
      } catch (streamErr) {
        clearTimeout(timeoutId);
        if (accumulated.trim().length > 80) {
          return { text: accumulated.trim(), sources: [], referencedPdfs: [] };
        }
        if (streamErr instanceof DOMException && streamErr.name === 'AbortError') {
          throw new ApiError(
            'AI serveridan javob kutish vaqti tugadi (120 soniya). Iltimos, «Qayta urinish» tugmasini bosing.',
            504
          );
        }
        if (attempt < retryDelaysMs.length) {
          await sleepClient(retryDelaysMs[attempt]);
          continue;
        }
        throw new ApiError(
          'Oqimli javobni o‘qishda tarmoq xatoligi yuz berdi. «Qayta urinish» tugmasini bosing.',
          0
        );
      }

      clearTimeout(timeoutId);

      if (donePayload) {
        return donePayload;
      }

      if (sseError) {
        const isTransientSse =
          !accumulated &&
          (sseError.status === 503 ||
            sseError.status === 500 ||
            sseError.status === 502 ||
            sseError.status === 504 ||
            sseError.status === 429);
        if (isTransientSse && attempt < retryDelaysMs.length) {
          await sleepClient(retryDelaysMs[attempt]);
          continue;
        }
        throw new ApiError(sseError.error, sseError.status);
      }

      if (accumulated.trim()) {
        return { text: accumulated.trim(), sources: [], referencedPdfs: [] };
      }

      if (attempt < retryDelaysMs.length) {
        await sleepClient(retryDelaysMs[attempt]);
        continue;
      }
      throw new ApiError('AI modelidan bo‘sh javob qaytdi. «Qayta urinish» tugmasini bosing.', 502);
    }

    clearTimeout(timeoutId);

    const rawText = await res.text();
    let data: Record<string, unknown> | null = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const isTransientStatus =
        res.status === 503 ||
        res.status === 500 ||
        res.status === 502 ||
        res.status === 504 ||
        res.status === 429;
      if (isTransientStatus && attempt < retryDelaysMs.length) {
        await sleepClient(retryDelaysMs[attempt]);
        continue;
      }
      const errMsg =
        data && typeof data.error === 'string' && data.error
          ? data.error
          : rawText && rawText.length < 300
            ? `Server xatoligi (${res.status}): ${rawText}`
            : `Server xatoligi (${res.status}). Iltimos, «Qayta urinish» tugmasini bosing.`;
      throw new ApiError(errMsg, res.status);
    }

    if (!data || typeof data.text !== 'string') {
      if (attempt < retryDelaysMs.length) {
        await sleepClient(retryDelaysMs[attempt]);
        continue;
      }
      throw new ApiError(
        'AI serveridan noto‘g‘ri javob formati keldi. Iltimos, «Qayta urinish» tugmasini bosing.',
        res.status
      );
    }

    return data as unknown as ChatApiResponse;
  }

  throw new ApiError(
    'Barcha AI modellari vaqtincha javob bermadi. Iltimos, «Qayta urinish» tugmasini bosing.',
    503
  );
}

function mapClientError(err: unknown, fallback: string): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof GeminiClientError) {
    return new ApiError(err.message, err.status);
  }
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'INVALID_CREDENTIALS') {
    return new ApiError('Login yoki parol noto‘g‘ri.', 401);
  }
  if (msg === 'ACCOUNT_BLOCKED') {
    return new ApiError('Sizning hisobingiz bloklangan. Administrator bilan bog‘laning.', 403);
  }
  if (msg === 'UNAUTHORIZED') {
    return new ApiError('Sessiya muddati tugagan yoki tizimga kirish talab etiladi.', 401);
  }
  if (msg === 'FORBIDDEN') {
    return new ApiError('Ushbu amal faqat administrator uchun ruxsat etilgan.', 403);
  }
  return new ApiError(msg || fallback, 400);
}

export const api = {
  async getAuthStatus(): Promise<AuthStatusResponse> {
    const configErr = getSupabaseConfigError();
    if (configErr) {
      return {
        adminConfigured: true,
        envAdminActive: false,
        documentCount: 0,
        supabaseError: configErr,
      };
    }

    try {
      await ensurePrimaryAdminInSupabase();
      const docs = await listSupabaseDocuments();
      return {
        adminConfigured: true,
        envAdminActive: true,
        documentCount: docs.length,
      };
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Supabase bazasiga ulanishda xatolik yuz berdi.';
      return {
        adminConfigured: true,
        envAdminActive: false,
        documentCount: 0,
        supabaseError: message,
      };
    }
  },

  async login(payload: {
    login: string;
    password: string;
  }): Promise<{ token: string; user: UserPublic }> {
    try {
      const user = await authenticateSupabaseUser(payload.login, payload.password);
      let token = `prolex-sb-${generateMessageId()}`;
      try {
        const cookieRes = await postStore<{ token: string; user: UserPublic }>('login', {
          login: payload.login.trim(),
          password: payload.password,
        });
        if (cookieRes?.token) {
          token = cookieRes.token;
        }
      } catch {
        // HttpOnly cookie sync is optional for page-refresh persistence
      }
      sessionUsersByToken.set(token, user);
      return { token, user };
    } catch (err) {
      throw mapClientError(err, 'Tizimga kirishda xatolik yuz berdi.');
    }
  },

  async restoreSession(): Promise<{ token: string; user: UserPublic } | null> {
    if (getSupabaseConfigError() !== null) {
      return null;
    }
    try {
      const res = await postStore<{
        session: { token: string; user: UserPublic } | null;
      }>('restoreSession', {});
      if (res?.session?.token && res?.session?.user) {
        sessionUsersByToken.set(res.session.token, res.session.user);
        return res.session;
      }
      return null;
    } catch {
      return null;
    }
  },

  logout(token: string | null): void {
    if (token) {
      sessionUsersByToken.delete(token);
    }
    void postStore('logout', {}, token).catch(() => {});
  },

  async getMe(token: string): Promise<{ user: UserPublic }> {
    try {
      const user = await resolveSupabaseSessionUser(token);
      return { user };
    } catch (err) {
      throw mapClientError(err, 'Foydalanuvchi topilmadi.');
    }
  },

  async getKnowledgeSummary(
    token: string
  ): Promise<{ count: number; documents: LegalDocumentMeta[] }> {
    try {
      await resolveSupabaseSessionUser(token);
      const documents = await listSupabaseDocuments();
      return { count: documents.length, documents };
    } catch (err) {
      throw mapClientError(err, 'Manbalar ro‘yxatini yuklashda xatolik.');
    }
  },

  // Chats (Supabase `chat_history` table only)
  async listChats(token: string): Promise<{ chats: ChatSessionSummary[] }> {
    try {
      const user = await resolveSupabaseSessionUser(token);
      const chats = await listSupabaseChats(user);
      return { chats };
    } catch (err) {
      throw mapClientError(err, 'Suhbatlar tarixini yuklashda xatolik.');
    }
  },

  async createChat(token: string, title?: string): Promise<{ chat: ChatSession }> {
    try {
      const user = await resolveSupabaseSessionUser(token);
      const chat = await createSupabaseChat(user, title);
      return { chat };
    } catch (err) {
      throw mapClientError(err, 'Yangi suhbat ochishda xatolik.');
    }
  },

  async getChat(token: string, chatId: string): Promise<{ chat: ChatSession }> {
    try {
      const user = await resolveSupabaseSessionUser(token);
      const chat = await getSupabaseChat(user, chatId);
      return { chat };
    } catch (err) {
      throw mapClientError(err, 'Suhbatni yuklab bo‘lmadi.');
    }
  },

  async deleteChat(token: string, chatId: string): Promise<{ ok: boolean }> {
    try {
      const user = await resolveSupabaseSessionUser(token);
      await deleteSupabaseChat(user, chatId);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'Suhbatni o‘chirishda xatolik.');
    }
  },

  async sendMessage(
    token: string,
    chatId: string,
    content: string,
    onStreamText?: (partialText: string) => void
  ): Promise<{
    chat: ChatSession;
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
  }> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new ApiError('Savol yoki kazus matnini kiriting.', 400);
    }
    if (trimmed.length > 15000) {
      throw new ApiError('Matn hajmi 15 000 belgidan oshmasligi kerak.', 400);
    }

    let sbUser: UserPublic;
    let chat: ChatSession;
    let pdfContext: { catalogSummary: string; matches: PdfExcerptPayload[] };

    try {
      sbUser = await resolveSupabaseSessionUser(token);
      chat = await getSupabaseChat(sbUser, chatId);
      const recentContext = chat.messages
        .slice(-4)
        .map((m) => m.content)
        .join(' ');
      const sbDocs = await listSupabaseDocuments();
      pdfContext = await searchRelevantPdfExcerptsClient(
        `${recentContext} ${trimmed}`,
        sbDocs,
        getSupabaseDocumentPages
      );
    } catch (err) {
      throw mapClientError(err, 'Suhbat ma’lumotlarini o‘qishda xatolik.');
    }

    const requestBody: ChatApiRequest = {
      userPrompt: trimmed,
      history: chat.messages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      pdfContext,
    };

    let analysis: ChatApiResponse;
    try {
      analysis = await postChatRequest(requestBody, onStreamText);
    } catch (err) {
      const canFallback =
        hasClientGeminiKey() &&
        err instanceof ApiError &&
        (err.status === 0 ||
          err.status === 404 ||
          err.status === 405 ||
          err.status === 429 ||
          err.status === 500 ||
          err.status === 502 ||
          err.status === 503 ||
          err.status === 504);
      if (canFallback) {
        try {
          let clientAccumulated = '';
          analysis = await generateLegalAnalysisClient(requestBody, {
            onDelta: (delta) => {
              clientAccumulated += delta;
              if (onStreamText) onStreamText(clientAccumulated);
            },
            onReset: () => {
              clientAccumulated = '';
              if (onStreamText) onStreamText('');
            },
          });
          if (onStreamText) onStreamText(analysis.text);
        } catch (fallbackErr) {
          throw mapClientError(
            fallbackErr,
            'Huquqiy tahlilni shakllantirishda Gemini API xatoligi yuz berdi.'
          );
        }
      } else {
        throw mapClientError(
          err,
          'Huquqiy tahlilni shakllantirishda server xatoligi yuz berdi.'
        );
      }
    }

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: analysis.text,
      createdAt: new Date().toISOString(),
      sources: analysis.sources,
      referencedPdfs: analysis.referencedPdfs,
    };

    const isFirstTurn = chat.messages.length === 0;
    const updatedTitle = isFirstTurn ? buildChatTitleFromPrompt(trimmed) : undefined;

    try {
      const updated = await appendSupabaseChatMessages(
        sbUser,
        chatId,
        [userMessage, assistantMessage],
        updatedTitle
      );
      return { chat: updated, userMessage, assistantMessage };
    } catch (err) {
      throw mapClientError(err, 'Yozishmalarni Supabase bazasiga saqlashda xatolik.');
    }
  },

  // Admin Users (Supabase `app_users` table only)
  async listUsers(token: string): Promise<{ users: UserPublic[] }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      const users = await listSupabaseUsers(sessionUser);
      return { users };
    } catch (err) {
      throw mapClientError(err, 'Foydalanuvchilar ro‘yxatini yuklashda xatolik.');
    }
  },

  async createUser(
    token: string,
    payload: { name: string; login: string; password: string }
  ): Promise<{ user: UserPublic }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      const user = await createSupabaseUser(sessionUser, payload);
      return { user };
    } catch (err) {
      throw mapClientError(err, 'Foydalanuvchi qo‘shishda xatolik.');
    }
  },

  async updateUser(
    token: string,
    userId: string,
    payload: { name?: string; login?: string; password?: string }
  ): Promise<{ user: UserPublic }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      const user = await updateSupabaseUser(sessionUser, userId, payload);
      return { user };
    } catch (err) {
      throw mapClientError(err, 'Foydalanuvchi ma’lumotlarini yangilashda xatolik.');
    }
  },

  async updateUserStatus(
    token: string,
    userId: string,
    status: UserStatus
  ): Promise<{ user: UserPublic }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      const user = await updateSupabaseUserStatus(sessionUser, userId, status);
      return { user };
    } catch (err) {
      throw mapClientError(err, 'Holatni o‘zgartirishda xatolik.');
    }
  },

  async deleteUser(token: string, userId: string): Promise<{ ok: boolean }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      await deleteSupabaseUser(sessionUser, userId);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'Foydalanuvchini o‘chirishda xatolik.');
    }
  },

  async updateAdminPassword(
    token: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ ok: boolean }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      await updateSupabaseAdminPassword(sessionUser, currentPassword, newPassword);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'Administrator parolini yangilashda xatolik.');
    }
  },

  async updateOwnPassword(
    token: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ ok: boolean }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      await updateOwnSupabasePassword(sessionUser, currentPassword, newPassword);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'Parolni yangilashda xatolik yuz berdi.');
    }
  },

  // Admin PDFs (up to 50 MB, stored directly in Supabase `prolex_documents` & `prolex_doc_pages`)
  async listDocuments(token: string): Promise<{ documents: LegalDocumentMeta[] }> {
    try {
      await resolveSupabaseSessionUser(token);
      const documents = await listSupabaseDocuments();
      return { documents };
    } catch (err) {
      throw mapClientError(err, 'PDF hujjatlarni yuklashda xatolik.');
    }
  },

  async uploadDocument(
    token: string,
    payload: { file: File; title: string; category: string; note: string },
    onProgress?: (percent: number) => void
  ): Promise<{ document: LegalDocumentMeta }> {
    const { file, title, category, note } = payload;

    const extOk = file.name.toLowerCase().endsWith('.pdf');
    const mimeOk =
      file.type === 'application/pdf' ||
      file.type === 'application/x-pdf' ||
      file.type === '';
    if (!extOk || !mimeOk) {
      throw new ApiError('Faqat PDF (.pdf) formatidagi hujjatlar qabul qilinadi.', 400);
    }

    if (file.size > MAX_PDF_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      throw new ApiError(
        `Tanlangan fayl hajmi ${sizeMb} MB. Maksimal ruxsat etilgan hajm: 50 MB.`,
        413
      );
    }

    if (!title.trim() || title.trim().length < 2) {
      throw new ApiError('Hujjat nomi kiritilishi shart.', 400);
    }
    if (!category.trim()) {
      throw new ApiError('Soha / turi tanlanishi shart.', 400);
    }

    onProgress?.(10);
    const validMagic = await verifyPdfMagicBytesClient(file);
    if (!validMagic) {
      throw new ApiError(
        'Tanlangan fayl haqiqiy PDF tuzilishiga ega emas. Iltimos, yaroqli PDF yuklang.',
        400
      );
    }

    const extracted = await extractPdfTextClient(file, (pct) => {
      onProgress?.(Math.min(82, pct));
    });

    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      const savedDoc = await saveSupabaseDocument(
        sessionUser,
        {
          title: title.trim().slice(0, 180),
          category: category.trim().slice(0, 80),
          note: note.trim().slice(0, 400),
          originalFileName: file.name,
          sizeBytes: file.size,
          pageCount: extracted.pageCount,
          extractedChars: extracted.extractedChars,
          indexed: true,
        },
        extracted.pages
      );
      onProgress?.(100);
      return { document: savedDoc };
    } catch (err) {
      throw mapClientError(err, 'PDF hujjatni Supabase bazasiga saqlashda xatolik yuz berdi.');
    }
  },

  async deleteDocument(token: string, docId: string): Promise<{ ok: boolean }> {
    try {
      const sessionUser = await resolveSupabaseSessionUser(token);
      await deleteSupabaseDocument(sessionUser, docId);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'PDF hujjatni o‘chirishda xatolik.');
    }
  },
};
