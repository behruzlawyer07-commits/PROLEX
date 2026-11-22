import type {
  AuthStatusResponse,
  ChatApiRequest,
  ChatApiResponse,
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
  LegalDocumentMeta,
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
  restoreClientSession,
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

  async restoreSession(): Promise<{ token: string; user: UserPublic } | null> {
    return restoreClientSession();
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
