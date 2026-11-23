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
  addClientDocument,
  addIndexedDbDocument,
  appendClientChatMessages,
  authenticateClientUser,
  createClientUser,
  createClientUserChat,
  deleteClientDocument,
  deleteClientUser,
  deleteClientUserChat,
  deleteIndexedDbDocument,
  getAuthStatusClient,
  getClientDocumentPages,
  getClientUserChat,
  listClientDocuments,
  listClientUserChats,
  listClientUsers,
  listIndexedDbDocuments,
  logoutClientSession,
  requireClientUser,
  restoreClientSession,
  updateAdminPasswordClient,
  updateClientUser,
  updateClientUserStatus,
} from './clientStore';
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
  getSupabaseDocumentPages,
  isPrimaryAdminUser,
  isSupabaseConfigured,
  listSupabaseChats,
  listSupabaseDocuments,
  listSupabaseUsers,
  saveSupabaseDocument,
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
const PDF_PAGE_CHUNK_CHARS = 750_000;

// In-memory session map (never stored in localStorage)
const sessionUsersByToken = new Map<string, UserPublic>();

let serverCloudEnabled: boolean | null = null;
let cloudProbePromise: Promise<boolean> | null = null;

async function probeCloudStore(): Promise<AuthStatusResponse & { cloudEnabled: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch('/api/store?action=status', {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as
      | (AuthStatusResponse & { cloudEnabled?: boolean; error?: string })
      | null;
    if (res.ok && data && data.cloudEnabled === true) {
      serverCloudEnabled = true;
      return {
        cloudEnabled: true,
        adminConfigured: Boolean(data.adminConfigured),
        envAdminActive: Boolean(data.envAdminActive),
        documentCount: Number(data.documentCount) || 0,
      };
    }
    serverCloudEnabled = false;
    return {
      cloudEnabled: false,
      adminConfigured: true,
      envAdminActive: false,
      documentCount: 0,
    };
  } catch {
    serverCloudEnabled = false;
    return {
      cloudEnabled: false,
      adminConfigured: true,
      envAdminActive: false,
      documentCount: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureServerCloudMode(): Promise<boolean> {
  if (serverCloudEnabled !== null) return serverCloudEnabled;
  if (!cloudProbePromise) {
    cloudProbePromise = probeCloudStore()
      .then((res) => res.cloudEnabled)
      .finally(() => {
        cloudProbePromise = null;
      });
  }
  return cloudProbePromise;
}

async function postStore<T>(
  action: string,
  payload: Record<string, unknown>,
  token?: string | null
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
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
      throw new ApiError('Bulutli baza bilan aloqa vaqti tugadi. Qayta urinib ko‘ring.', 504);
    }
    throw new ApiError('Bulutli ma’lumotlar bazasi (/api/store) bilan aloqa o‘rnatib bo‘lmadi.', 0);
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

function chunkPagesByCharBudget(pages: string[], budget: number): string[][] {
  if (pages.length === 0) return [[]];
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const page of pages) {
    const len = page.length;
    if (current.length > 0 && currentChars + len > budget) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(page);
    currentChars += len;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
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

async function postChatRequest(payload: ChatApiRequest): Promise<ChatApiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 58_000);

  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        'AI serveridan javob kutish vaqti tugadi (58 soniya). Iltimos, qayta urinib ko‘ring.',
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
        : rawText && rawText.length < 300
          ? `Server xatoligi (${res.status}): ${rawText}`
          : `Server xatoligi (${res.status}). Vercel Functions loglarini tekshiring.`;
    throw new ApiError(errMsg, res.status);
  }

  if (!data || typeof data.text !== 'string') {
    throw new ApiError(
      'AI serveridan noto‘g‘ri javob formati keldi. Iltimos, qayta urinib ko‘ring.',
      res.status
    );
  }

  return data as unknown as ChatApiResponse;
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
    if (isSupabaseConfigured()) {
      try {
        await ensurePrimaryAdminInSupabase();
        const docs = await listSupabaseDocuments();
        return {
          adminConfigured: true,
          envAdminActive: true,
          documentCount: docs ? docs.length : 0,
        };
      } catch {
        // Fallback probe below if direct browser check failed
      }
    }

    const cloudStatus = await probeCloudStore();
    if (cloudStatus.cloudEnabled) {
      return {
        adminConfigured: cloudStatus.adminConfigured,
        envAdminActive: cloudStatus.envAdminActive,
        documentCount: cloudStatus.documentCount,
      };
    }
    return getAuthStatusClient();
  },

  async login(payload: {
    login: string;
    password: string;
  }): Promise<{ token: string; user: UserPublic }> {
    try {
      if (isSupabaseConfigured()) {
        const user = await authenticateSupabaseUser(payload.login, payload.password);
        let token = `prolex-sb-${generateMessageId()}`;
        try {
          const cookieRes = await postStore<{ token: string; user: UserPublic }>('login', {
            login: payload.login,
            password: payload.password,
          });
          if (cookieRes?.token) {
            token = cookieRes.token;
          }
        } catch {
          // Best-effort HttpOnly cookie sync; session continues in memory
        }
        sessionUsersByToken.set(token, user);
        return { token, user };
      }

      if (await ensureServerCloudMode()) {
        const res = await postStore<{ token: string; user: UserPublic }>('login', {
          login: payload.login,
          password: payload.password,
        });
        sessionUsersByToken.set(res.token, res.user);
        return res;
      }

      return await authenticateClientUser(payload.login, payload.password);
    } catch (err) {
      throw mapClientError(err, 'Tizimga kirishda xatolik yuz berdi.');
    }
  },

  async restoreSession(): Promise<{ token: string; user: UserPublic } | null> {
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
      return restoreClientSession();
    }
  },

  logout(token: string | null): void {
    if (token) {
      sessionUsersByToken.delete(token);
    }
    void postStore('logout', {}, token).catch(() => {});
    logoutClientSession(token);
  },

  async getMe(token: string): Promise<{ user: UserPublic }> {
    try {
      if (isSupabaseConfigured()) {
        const user = await resolveSupabaseSessionUser(token);
        return { user };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ user: UserPublic }>('getMe', {}, token);
      }
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
      if (isSupabaseConfigured()) {
        await resolveSupabaseSessionUser(token);
        const sbDocs = await listSupabaseDocuments();
        if (sbDocs !== null) {
          return { count: sbDocs.length, documents: sbDocs };
        }
        const idbDocs = await listIndexedDbDocuments().catch(() => []);
        return { count: idbDocs.length, documents: idbDocs };
      }
      if (await ensureServerCloudMode()) {
        const res = await postStore<{ documents: LegalDocumentMeta[] }>(
          'listDocuments',
          {},
          token
        );
        return { count: res.documents.length, documents: res.documents };
      }
      const documents = await listClientDocuments(token);
      return { count: documents.length, documents };
    } catch (err) {
      throw mapClientError(err, 'Manbalar ro‘yxatini yuklashda xatolik.');
    }
  },

  // Chats (`chat_history` in Supabase)
  async listChats(token: string): Promise<{ chats: ChatSessionSummary[] }> {
    try {
      if (isSupabaseConfigured()) {
        const user = await resolveSupabaseSessionUser(token);
        const chats = await listSupabaseChats(user);
        return { chats };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ chats: ChatSessionSummary[] }>('listChats', {}, token);
      }
      const chats = await listClientUserChats(token);
      return { chats };
    } catch (err) {
      throw mapClientError(err, 'Suhbatlar tarixini yuklashda xatolik.');
    }
  },

  async createChat(token: string, title?: string): Promise<{ chat: ChatSession }> {
    try {
      if (isSupabaseConfigured()) {
        const user = await resolveSupabaseSessionUser(token);
        const chat = await createSupabaseChat(user, title);
        return { chat };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ chat: ChatSession }>('createChat', { title }, token);
      }
      const chat = await createClientUserChat(token, title);
      return { chat };
    } catch (err) {
      throw mapClientError(err, 'Yangi suhbat ochishda xatolik.');
    }
  },

  async getChat(token: string, chatId: string): Promise<{ chat: ChatSession }> {
    try {
      if (isSupabaseConfigured()) {
        const user = await resolveSupabaseSessionUser(token);
        const chat = await getSupabaseChat(user, chatId);
        return { chat };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ chat: ChatSession }>('getChat', { chatId }, token);
      }
      const chat = await getClientUserChat(token, chatId);
      return { chat };
    } catch (err) {
      throw mapClientError(err, 'Suhbatni yuklab bo‘lmadi.');
    }
  },

  async deleteChat(token: string, chatId: string): Promise<{ ok: boolean }> {
    try {
      if (isSupabaseConfigured()) {
        const user = await resolveSupabaseSessionUser(token);
        await deleteSupabaseChat(user, chatId);
        return { ok: true };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ ok: boolean }>('deleteChat', { chatId }, token);
      }
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

    const useDirectSupabase = isSupabaseConfigured();
    const useServerCloud = !useDirectSupabase && (await ensureServerCloudMode());
    let chat: ChatSession;
    let pdfContext: { catalogSummary: string; matches: PdfExcerptPayload[] };
    let sbUser: UserPublic | null = null;

    try {
      if (useDirectSupabase) {
        sbUser = await resolveSupabaseSessionUser(token);
        chat = await getSupabaseChat(sbUser, chatId);
        const recentContext = chat.messages
          .slice(-4)
          .map((m) => m.content)
          .join(' ');
        const sbDocs = await listSupabaseDocuments();
        if (sbDocs !== null) {
          pdfContext = await searchRelevantPdfExcerptsClient(
            `${recentContext} ${trimmed}`,
            sbDocs,
            getSupabaseDocumentPages
          );
        } else {
          const idbDocs = await listIndexedDbDocuments().catch(() => []);
          pdfContext = await searchRelevantPdfExcerptsClient(
            `${recentContext} ${trimmed}`,
            idbDocs,
            getClientDocumentPages
          );
        }
      } else if (useServerCloud) {
        const chatRes = await postStore<{ chat: ChatSession }>(
          'getChat',
          { chatId },
          token
        );
        chat = chatRes.chat;
        const recentContext = chat.messages
          .slice(-4)
          .map((m) => m.content)
          .join(' ');
        pdfContext = await postStore<{
          catalogSummary: string;
          matches: PdfExcerptPayload[];
        }>(
          'searchDocumentExcerpts',
          { query: `${recentContext} ${trimmed}`.slice(0, 6000) },
          token
        );
      } else {
        const [localChat, docs] = await Promise.all([
          getClientUserChat(token, chatId),
          listClientDocuments(token),
        ]);
        chat = localChat;
        const recentContext = chat.messages
          .slice(-4)
          .map((m) => m.content)
          .join(' ');
        pdfContext = await searchRelevantPdfExcerptsClient(
          `${recentContext} ${trimmed}`,
          docs,
          getClientDocumentPages
        );
      }
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
      analysis = await postChatRequest(requestBody);
    } catch (err) {
      const canFallback =
        hasClientGeminiKey() &&
        err instanceof ApiError &&
        (err.status === 0 ||
          err.status === 404 ||
          err.status === 405 ||
          err.status === 500 ||
          err.status === 503);
      if (canFallback) {
        try {
          analysis = await generateLegalAnalysisClient(requestBody);
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

    if (useDirectSupabase && sbUser) {
      const updated = await appendSupabaseChatMessages(
        sbUser,
        chatId,
        [userMessage, assistantMessage],
        updatedTitle
      );
      return { chat: updated, userMessage, assistantMessage };
    }

    if (useServerCloud) {
      const saved = await postStore<{ chat: ChatSession }>(
        'appendChatMessages',
        {
          chatId,
          newMessages: [userMessage, assistantMessage],
          newTitle: updatedTitle,
        },
        token
      );
      return { chat: saved.chat, userMessage, assistantMessage };
    }

    const updatedChat = await appendClientChatMessages(
      token,
      chatId,
      [userMessage, assistantMessage],
      updatedTitle
    );
    return { chat: updatedChat, userMessage, assistantMessage };
  },

  // Admin Users (`app_users` in Supabase)
  async listUsers(token: string): Promise<{ users: UserPublic[] }> {
    try {
      if (isSupabaseConfigured()) {
        const sessionUser = await resolveSupabaseSessionUser(token);
        const users = await listSupabaseUsers(sessionUser);
        return { users };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ users: UserPublic[] }>('listUsers', {}, token);
      }
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
      if (isSupabaseConfigured()) {
        const sessionUser = await resolveSupabaseSessionUser(token);
        const user = await createSupabaseUser(sessionUser, payload);
        return { user };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ user: UserPublic }>('createUser', payload, token);
      }
      const user = await createClientUser(token, payload);
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
      if (isSupabaseConfigured()) {
        const sessionUser = await resolveSupabaseSessionUser(token);
        const user = await updateSupabaseUser(sessionUser, userId, payload);
        return { user };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ user: UserPublic }>(
          'updateUser',
          { userId, ...payload },
          token
        );
      }
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
      if (isSupabaseConfigured()) {
        const sessionUser = await resolveSupabaseSessionUser(token);
        const user = await updateSupabaseUserStatus(sessionUser, userId, status);
        return { user };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ user: UserPublic }>(
          'updateUserStatus',
          { userId, status },
          token
        );
      }
      const user = await updateClientUserStatus(token, userId, status);
      return { user };
    } catch (err) {
      throw mapClientError(err, 'Holatni o‘zgartirishda xatolik.');
    }
  },

  async deleteUser(token: string, userId: string): Promise<{ ok: boolean }> {
    try {
      if (isSupabaseConfigured()) {
        const sessionUser = await resolveSupabaseSessionUser(token);
        await deleteSupabaseUser(sessionUser, userId);
        return { ok: true };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ ok: boolean }>('deleteUser', { userId }, token);
      }
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
      if (isSupabaseConfigured()) {
        const sessionUser = await resolveSupabaseSessionUser(token);
        await updateSupabaseAdminPassword(sessionUser, currentPassword, newPassword);
        return { ok: true };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ ok: boolean }>(
          'updateAdminPassword',
          { currentPassword, newPassword },
          token
        );
      }
      await updateAdminPasswordClient(token, currentPassword, newPassword);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'Administrator parolini yangilashda xatolik.');
    }
  },

  // Admin PDFs (up to 50 MB, client-extracted & saved cross-device in Supabase or IndexedDB)
  async listDocuments(token: string): Promise<{ documents: LegalDocumentMeta[] }> {
    try {
      if (isSupabaseConfigured()) {
        await resolveSupabaseSessionUser(token);
        const sbDocs = await listSupabaseDocuments();
        if (sbDocs !== null) {
          return { documents: sbDocs };
        }
        const idbDocs = await listIndexedDbDocuments().catch(() => []);
        return { documents: idbDocs };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ documents: LegalDocumentMeta[] }>(
          'listDocuments',
          {},
          token
        );
      }
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

    const extracted = await extractPdfTextClient(file, (pct) => {
      onProgress?.(Math.min(82, pct));
    });

    try {
      if (isSupabaseConfigured()) {
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
        if (savedDoc) {
          onProgress?.(100);
          return { document: savedDoc };
        }
        if (!isPrimaryAdminUser(sessionUser)) {
          throw new Error('FORBIDDEN');
        }
        // Fallback to IndexedDB if optional prolex_documents table wasn't created in Supabase
        const idbDoc = await addIndexedDbDocument(
          sessionUser.name,
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
        return { document: idbDoc };
      }

      if (await ensureServerCloudMode()) {
        const chunks = chunkPagesByCharBudget(extracted.pages, PDF_PAGE_CHUNK_CHARS);
        const initRes = await postStore<{ document: LegalDocumentMeta }>(
          'uploadDocumentInit',
          {
            title: title.trim().slice(0, 180),
            category: category.trim().slice(0, 80),
            note: note.trim().slice(0, 400),
            originalFileName: file.name,
            sizeBytes: file.size,
            pageCount: extracted.pageCount,
            extractedChars: extracted.extractedChars,
            pages: chunks[0] ?? [],
          },
          token
        );

        for (let i = 1; i < chunks.length; i++) {
          await postStore(
            'appendDocumentPages',
            { docId: initRes.document.id, pages: chunks[i] },
            token
          );
          const pct = 82 + Math.round(((i + 1) / chunks.length) * 18);
          onProgress?.(Math.min(99, pct));
        }

        onProgress?.(100);
        return { document: initRes.document };
      }

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
      if (isSupabaseConfigured()) {
        const sessionUser = await resolveSupabaseSessionUser(token);
        if (!isPrimaryAdminUser(sessionUser)) {
          throw new Error('FORBIDDEN');
        }
        const deleted = await deleteSupabaseDocument(sessionUser, docId);
        if (deleted) return { ok: true };
        await deleteIndexedDbDocument(docId);
        return { ok: true };
      }
      if (await ensureServerCloudMode()) {
        return await postStore<{ ok: boolean }>('deleteDocument', { docId }, token);
      }
      await deleteClientDocument(token, docId);
      return { ok: true };
    } catch (err) {
      throw mapClientError(err, 'PDF hujjatni o‘chirishda xatolik.');
    }
  },
};
