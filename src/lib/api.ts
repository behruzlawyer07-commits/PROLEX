import type {
  AuthStatusResponse,
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
  LegalDocumentMeta,
  UserPublic,
  UserStatus,
} from '../types/sherlex';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
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
        : res.status === 502 || res.status === 504
          ? 'Server javob berish vaqti tugadi yoki qayta yuklanmoqda. Iltimos, qayta urinib ko‘ring.'
          : `Server xatoligi (${res.status})`;
    throw new ApiError(errMsg, res.status);
  }

  if (!data) {
    throw new ApiError(
      'Server bilan aloqa vaqtincha uzildi yoki server qayta ishga tushmoqda. Qayta urinib ko‘ring.',
      res.status
    );
  }

  return data as unknown as T;
}

export const api = {
  getAuthStatus(): Promise<AuthStatusResponse> {
    return requestJson<AuthStatusResponse>('/api/auth/status');
  },

  bootstrapAdmin(payload: {
    name: string;
    login: string;
    password: string;
  }): Promise<{ token: string; user: UserPublic }> {
    return requestJson('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  login(payload: {
    login: string;
    password: string;
  }): Promise<{ token: string; user: UserPublic }> {
    return requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getMe(token: string): Promise<{ user: UserPublic }> {
    return requestJson('/api/auth/me', {}, token);
  },

  getKnowledgeSummary(token: string): Promise<{ count: number; documents: LegalDocumentMeta[] }> {
    return requestJson('/api/knowledge/summary', {}, token);
  },

  // Chats
  listChats(token: string): Promise<{ chats: ChatSessionSummary[] }> {
    return requestJson('/api/chats', {}, token);
  },

  createChat(token: string, title?: string): Promise<{ chat: ChatSession }> {
    return requestJson(
      '/api/chats',
      {
        method: 'POST',
        body: JSON.stringify({ title }),
      },
      token
    );
  },

  getChat(token: string, chatId: string): Promise<{ chat: ChatSession }> {
    return requestJson(`/api/chats/${encodeURIComponent(chatId)}`, {}, token);
  },

  deleteChat(token: string, chatId: string): Promise<{ ok: boolean }> {
    return requestJson(
      `/api/chats/${encodeURIComponent(chatId)}`,
      { method: 'DELETE' },
      token
    );
  },

  sendMessage(
    token: string,
    chatId: string,
    content: string
  ): Promise<{
    chat: ChatSession;
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
  }> {
    return requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
      },
      token
    );
  },

  // Admin Users
  listUsers(token: string): Promise<{ users: UserPublic[] }> {
    return requestJson('/api/admin/users', {}, token);
  },

  createUser(
    token: string,
    payload: { name: string; login: string; password: string }
  ): Promise<{ user: UserPublic }> {
    return requestJson(
      '/api/admin/users',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  updateUserStatus(
    token: string,
    userId: string,
    status: UserStatus
  ): Promise<{ user: UserPublic }> {
    return requestJson(
      `/api/admin/users/${encodeURIComponent(userId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      token
    );
  },

  deleteUser(token: string, userId: string): Promise<{ ok: boolean }> {
    return requestJson(
      `/api/admin/users/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
      token
    );
  },

  // Admin PDFs
  listDocuments(token: string): Promise<{ documents: LegalDocumentMeta[] }> {
    return requestJson('/api/admin/documents', {}, token);
  },

  uploadDocument(
    token: string,
    payload: { file: File; title: string; category: string; note: string },
    onProgress?: (percent: number) => void
  ): Promise<{ document: LegalDocumentMeta }> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('title', payload.title);
      formData.append('category', payload.category);
      formData.append('note', payload.note);
      formData.append('file', payload.file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/documents');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
          onProgress(pct);
        }
      };

      xhr.onload = () => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(xhr.responseText) as Record<string, unknown>;
        } catch {
          // ignore
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(100);
          resolve(parsed as unknown as { document: LegalDocumentMeta });
        } else {
          const msg =
            typeof parsed.error === 'string' && parsed.error
              ? parsed.error
              : `Yuklashda xatolik (${xhr.status})`;
          reject(new ApiError(msg, xhr.status));
        }
      };

      xhr.onerror = () => {
        reject(new ApiError('Tarmoq xatoligi: faylni yuklab bo‘lmadi.', 0));
      };

      xhr.send(formData);
    });
  },

  deleteDocument(token: string, docId: string): Promise<{ ok: boolean }> {
    return requestJson(
      `/api/admin/documents/${encodeURIComponent(docId)}`,
      { method: 'DELETE' },
      token
    );
  },
};
