import type {
  AuthStatusResponse,
  ChatApiRequest,
  ChatApiResponse,
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
  GroundingSource,
  LegalDocumentMeta,
  UserPublic,
  UserStatus,
} from '../types/sherlex';
import {
  extractPdfTextClient,
  searchRelevantPdfExcerptsClient,
  verifyPdfMagicBytesClient,
} from './clientPdfService';
import {
  addClientDocument,
  appendClientChatMessages,
  authenticateClientUser,
  createClientUser,
  createClientUserChat,
  deleteClientDocument,
  deleteClientUser,
  deleteClientUserChat,
  getAuthStatusClient,
  getClientDocumentPages,
  getClientUserChat,
  listClientDocuments,
  listClientUserChats,
  listClientUsers,
  logoutClientSession,
  requireClientUser,
  resetDefaultAdminClient,
  updateAdminPasswordClient,
  updateClientUser,
  updateClientUserStatus,
} from './clientStore';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

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

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000);

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        'AI serveridan javob kutish vaqti tugadi (55 soniya). Iltimos, qayta urinib ko‘ring.',
        504
      );
    }
    throw new ApiError(
      'AI tahlil serveri (/api/chat) bilan tarmoq aloqasi o‘rnatib bo‘lmadi.',
      0
    );
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
    const errMsg =
      data && typeof data.error === 'string' && data.error
        ? data.error
        : res.status === 404
          ? 'Serverless /api/chat manzili topilmadi (404).'
          : res.status === 502 || res.status === 504
            ? 'Server javob berish vaqti tugadi yoki qayta yuklanmoqda. Iltimos, qayta urinib ko‘ring.'
            : `Server xatoligi (${res.status})`;
    throw new ApiError(errMsg, res.status);
  }

  if (!data) {
    throw new ApiError(
      'AI serveridan noto‘g‘ri javob formati keldi. Iltimos, qayta urinib ko‘ring.',
      res.status
    );
  }

  return data as unknown as T;
}

const CLIENT_SYSTEM_INSTRUCTION = `Siz "PROLEX" — O'zbekiston Respublikasi Huquqni muhofaza qilish akademiyasi (HMQA) tinglovchilari hamda O'zbekiston Respublikasi Prokuratura organlari xodimlari uchun yaratilgan ixtisoslashtirilgan, yuqori malakali huquqshunos-olim va prokuror-tahlilchi sun'iy intellekt yordamchisisiz.

Har qanday kazus, nazariy savol yoki taqqoslash masalasiga faqat o‘zbek tilida (lotin alifbosida), Lex.uz rasmiy qonunchiligi hamda yuklangan ichki PDF manbalarga tayanib, hech qanday moddani o‘ylab topmasdan, quyidagi 4 ta bo‘limda batafsil javob bering:

### 1. Savol mohiyati
### 2. Hujjat nomi va aniq moddalar
### 3. Bevosita va bilvosita tartibga solish tahlili hamda huquqiy xulosa
### 4. Foydalanilgan qonunlar va Lex.uz havolalari
(Barcha qonun, kodeks va Oliy sud Plenumi qarorlari uchun bosiladigan https://lex.uz/uz/... havolalarini hamda oxirida *"Eslatma: Normativ-huquqiy hujjatlarning amaldagi so‘nggi tahriri va rasmiy matnini bevosita Lex.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi."* eslatmasini kiriting.)`;

async function optionalClientSerperSearch(query: string): Promise<GroundingSource[]> {
  const serperKey = String(import.meta.env.VITE_SERPER_API_KEY ?? '').trim();
  if (!serperKey || serperKey.startsWith('MY_')) return [];

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-API-KEY': serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `site:lex.uz ${query.slice(0, 120)}`,
        num: 6,
        hl: 'uz',
        gl: 'uz',
      }),
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string }>;
    };
    const out: GroundingSource[] = [];
    for (const item of data.organic ?? []) {
      if (!item.link || !item.title) continue;
      try {
        const u = new URL(item.link);
        if (u.hostname === 'lex.uz' || u.hostname.endsWith('.lex.uz')) {
          out.push({ title: item.title.replace(/\s*\|\s*lex\.uz.*$/i, '').trim(), url: item.link });
        }
      } catch {
        // ignore
      }
    }
    return out.slice(0, 6);
  } catch {
    // Gracefully skip if CORS-blocked or unreachable
    return [];
  }
}

async function callGeminiDirectFallback(
  req: ChatApiRequest
): Promise<ChatApiResponse | null> {
  const apiKey = String(import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
  if (!apiKey || apiKey.startsWith('MY_')) return null;

  const serperLinks = await optionalClientSerperSearch(req.userPrompt);
  const referencedPdfs: string[] = [];
  let pdfBlock = '';

  if (req.pdfContext?.catalogSummary) {
    pdfBlock += `\n\n[ICHKI PDF REYESTRI]:\n${req.pdfContext.catalogSummary}`;
  }
  if (req.pdfContext?.matches?.length) {
    pdfBlock += '\n\n[MOS KELGAN PDF PARCHALARI]:\n';
    for (const m of req.pdfContext.matches) {
      if (!referencedPdfs.includes(m.title)) referencedPdfs.push(m.title);
      pdfBlock += `\n--- "${m.title}" (${m.category}, ${m.pageNumber}-bet) ---\n${m.excerpt}\n`;
    }
  }
  const serperBlock =
    serperLinks.length > 0
      ? `\n\n[LEX.UZ TOPILGAN HAVOLALAR]:\n${serperLinks
          .map((s) => `- ${s.title}: ${s.url}`)
          .join('\n')}`
      : '';

  const contents = [
    ...req.history.slice(-6).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content.slice(0, 3000) }],
    })),
    {
      role: 'user',
      parts: [{ text: `${req.userPrompt}${serperBlock}${pdfBlock}` }],
    },
  ];

  const models = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
  let lastErrMsg = '';

  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CLIENT_SYSTEM_INSTRUCTION }] },
          contents,
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      error?: { message?: string; status?: string };
    };
    if (!res.ok) {
      lastErrMsg = json.error?.message || `HTTP ${res.status}`;
      continue;
    }
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
      .trim();
    if (text) {
      let finalText = text;
      if (!/lex\.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi/i.test(finalText)) {
        finalText +=
          '\n\n*Eslatma: Normativ-huquqiy hujjatlarning amaldagi so‘nggi tahriri va rasmiy matnini bevosita Lex.uz milliy bazasi orqali tekshirishingiz tavsiya etiladi.*';
      }
      return {
        text: finalText,
        sources: serperLinks,
        referencedPdfs,
      };
    }
  }

  throw new ApiError(
    lastErrMsg
      ? `Gemini API xatoligi: ${lastErrMsg}`
      : 'Gemini API dan javob olib bo‘lmadi.',
    502
  );
}

function mapClientError(err: unknown, fallback: string): ApiError {
  if (err instanceof ApiError) return err;
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
    return getAuthStatusClient();
  },

  async login(payload: {
    login: string;
    password: string;
  }): Promise<{ token: string; user: UserPublic }> {
    try {
      return await authenticateClientUser(payload.login, payload.password);
    } catch (err) {
      throw mapClientError(err, 'Tizimga kirishda xatolik yuz berdi.');
    }
  },

  async resetDefaultAdmin(): Promise<UserPublic> {
    try {
      return await resetDefaultAdminClient();
    } catch (err) {
      throw mapClientError(err, 'Administrator parolini tiklashda xatolik yuz berdi.');
    }
  },

  logout(token: string | null): void {
    logoutClientSession(token);
  },

  async getMe(token: string): Promise<{ user: UserPublic }> {
    try {
      const user = await requireClientUser(token);
      return { user };
    } catch (err) {
      throw mapClientError(err, 'Foydalanuvchi topilmadi.');
    }
  },

  async getKnowledgeSummary(
    token: string
  ): Promise<{ count: number; documents: LegalDocumentMeta[] }> {
    try {
      const documents = await listClientDocuments(token);
      return { count: documents.length, documents };
    } catch (err) {
      throw mapClientError(err, 'Manbalar ro‘yxatini yuklashda xatolik.');
    }
  },

  // Chats (IndexedDB user-isolated)
  async listChats(token: string): Promise<{ chats: ChatSessionSummary[] }> {
    try {
      const chats = await listClientUserChats(token);
      return { chats };
    } catch (err) {
      throw mapClientError(err, 'Suhbatlar tarixini yuklashda xatolik.');
    }
  },

  async createChat(token: string, title?: string): Promise<{ chat: ChatSession }> {
    try {
      const chat = await createClientUserChat(token, title);
      return { chat };
    } catch (err) {
      throw mapClientError(err, 'Yangi suhbat ochishda xatolik.');
    }
  },

  async getChat(token: string, chatId: string): Promise<{ chat: ChatSession }> {
    try {
      const chat = await getClientUserChat(token, chatId);
      return { chat };
    } catch (err) {
      throw mapClientError(err, 'Suhbatni yuklab bo‘lmadi.');
    }
  },

  async deleteChat(token: string, chatId: string): Promise<{ ok: boolean }> {
    try {
      await deleteClientUserChat(token, chatId);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'Suhbatni o‘chirishda xatolik.');
    }
  },

  async sendMessage(
    token: string,
    chatId: string,
    content: string
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

    let chat: ChatSession;
    let docs: LegalDocumentMeta[];
    try {
      [chat, docs] = await Promise.all([
        getClientUserChat(token, chatId),
        listClientDocuments(token),
      ]);
    } catch (err) {
      throw mapClientError(err, 'Suhbat ma’lumotlarini o‘qishda xatolik.');
    }

    const recentContext = chat.messages
      .slice(-4)
      .map((m) => m.content)
      .join(' ');

    const pdfContext = await searchRelevantPdfExcerptsClient(
      `${recentContext} ${trimmed}`,
      docs,
      getClientDocumentPages
    );

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
      analysis = await requestJson<ChatApiResponse>('/api/chat', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      const canFallback =
        err instanceof ApiError &&
        (err.status === 0 || err.status === 404 || err.status === 405 || err.status === 503);
      if (canFallback) {
        const direct = await callGeminiDirectFallback(requestBody);
        if (direct) {
          analysis = direct;
        } else {
          throw err;
        }
      } else {
        throw err;
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
    const updatedChat = await appendClientChatMessages(
      token,
      chatId,
      [userMessage, assistantMessage],
      updatedTitle
    );

    return { chat: updatedChat, userMessage, assistantMessage };
  },

  // Admin Users
  async listUsers(token: string): Promise<{ users: UserPublic[] }> {
    try {
      const users = await listClientUsers(token);
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
      const user = await createClientUser(token, { ...payload, role: 'user' });
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
      const user = await updateClientUser(token, userId, payload);
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
      const user = await updateClientUserStatus(token, userId, status);
      return { user };
    } catch (err) {
      throw mapClientError(err, 'Holatni o‘zgartirishda xatolik.');
    }
  },

  async deleteUser(token: string, userId: string): Promise<{ ok: boolean }> {
    try {
      await deleteClientUser(token, userId);
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
      await updateAdminPasswordClient(token, currentPassword, newPassword);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'Administrator parolini yangilashda xatolik.');
    }
  },

  // Admin PDFs (up to 50 MB, client-side extracted & IndexedDB stored)
  async listDocuments(token: string): Promise<{ documents: LegalDocumentMeta[] }> {
    try {
      const documents = await listClientDocuments(token);
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

    const extracted = await extractPdfTextClient(file, onProgress);

    try {
      const document = await addClientDocument(
        token,
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
      return { document };
    } catch (err) {
      throw mapClientError(err, 'PDF hujjatni saqlash va indekslashda xatolik yuz berdi.');
    }
  },

  async deleteDocument(token: string, docId: string): Promise<{ ok: boolean }> {
    try {
      await deleteClientDocument(token, docId);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'PDF hujjatni o‘chirishda xatolik.');
    }
  },
};
