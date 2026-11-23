import type {
  AuthStatusResponse,
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
  LegalDocumentMeta,
  UserPublic,
  UserRole,
  UserStatus,
} from '../types/sherlex';

export const DEFAULT_ADMIN_LOGIN = 'Prolex@admin';
export const DEFAULT_ADMIN_PASSWORD = '00081187';
const PRIMARY_ADMIN_ID = 'admin-default-prolex';

const DB_NAME = 'prolex_client_db_v1';
const DB_VERSION = 1;

const STORE_USERS = 'users';
const STORE_CHATS = 'chats';
const STORE_DOCS = 'documents';
const STORE_DOC_PAGES = 'docPages';

interface StoredUser extends UserPublic {
  passwordHash: string;
  passwordSalt: string;
}

interface StoredDocPages {
  docId: string;
  pages: string[];
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSaltHex(len = 16): string {
  const arr = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(arr);
}

function fallbackHash(input: string): string {
  // Deterministic FNV-1a multi-round fallback only when crypto.subtle is unavailable (non-HTTPS localhost)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let round = 0; round < 64; round++) {
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i) ^ round;
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= (code + i) & 0xff;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
  }
  return `fb:${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: enc.encode(salt),
          iterations: 100_000,
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );
      return `pbkdf2:${bytesToHex(new Uint8Array(bits))}`;
    } catch {
      // fall through
    }
  }
  return fallbackHash(`${salt}:${password}`);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyPassword(
  password: string,
  salt: string,
  storedHash: string
): Promise<boolean> {
  const computed = await hashPassword(password, salt);
  if (computed.startsWith('pbkdf2:') && storedHash.startsWith('pbkdf2:')) {
    return timingSafeEqualStr(computed, storedHash);
  }
  return timingSafeEqualStr(fallbackHash(`${salt}:${password}`), storedHash);
}

function toPublicUser(u: StoredUser): UserPublic {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
  };
}

// IndexedDB wrapper with in-memory fallback if IndexedDB is unavailable (no localStorage for users or chats)
let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryFallback = {
  users: new Map<string, StoredUser>(),
  chats: new Map<string, ChatSession>(),
  documents: new Map<string, LegalDocumentMeta>(),
  docPages: new Map<string, StoredDocPages>(),
};

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_USERS)) {
          db.createObjectStore(STORE_USERS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CHATS)) {
          const chatStore = db.createObjectStore(STORE_CHATS, { keyPath: 'id' });
          chatStore.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_DOC_PAGES)) {
          db.createObjectStore(STORE_DOC_PAGES, { keyPath: 'docId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  if (!db) {
    if (storeName === STORE_USERS) return Array.from(memoryFallback.users.values()) as unknown as T[];
    if (storeName === STORE_CHATS) return Array.from(memoryFallback.chats.values()) as unknown as T[];
    if (storeName === STORE_DOCS) return Array.from(memoryFallback.documents.values()) as unknown as T[];
    return [];
  }
  return await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) {
    if (storeName === STORE_USERS) return memoryFallback.users.get(key) as unknown as T | undefined;
    if (storeName === STORE_CHATS) return memoryFallback.chats.get(key) as unknown as T | undefined;
    if (storeName === STORE_DOCS) return memoryFallback.documents.get(key) as unknown as T | undefined;
    if (storeName === STORE_DOC_PAGES) return memoryFallback.docPages.get(key) as unknown as T | undefined;
    return undefined;
  }
  return await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) {
    if (storeName === STORE_USERS) {
      const v = value as unknown as StoredUser;
      memoryFallback.users.set(v.id, v);
    } else if (storeName === STORE_CHATS) {
      const v = value as unknown as ChatSession;
      memoryFallback.chats.set(v.id, v);
    } else if (storeName === STORE_DOCS) {
      const v = value as unknown as LegalDocumentMeta;
      memoryFallback.documents.set(v.id, v);
    } else if (storeName === STORE_DOC_PAGES) {
      const v = value as unknown as StoredDocPages;
      memoryFallback.docPages.set(v.docId, v);
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    if (storeName === STORE_USERS) memoryFallback.users.delete(key);
    else if (storeName === STORE_CHATS) memoryFallback.chats.delete(key);
    else if (storeName === STORE_DOCS) memoryFallback.documents.delete(key);
    else if (storeName === STORE_DOC_PAGES) memoryFallback.docPages.delete(key);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// In-memory session map only (no localStorage)
const activeSessions = new Map<string, string>();
let ensureSeedPromise: Promise<void> | null = null;

function persistSessionToken(token: string, userId: string): void {
  activeSessions.set(token, userId);
}

function clearPersistedSession(token?: string | null): void {
  if (token) activeSessions.delete(token);
}

async function ensureDefaultAdminSeeded(): Promise<void> {
  if (ensureSeedPromise) return ensureSeedPromise;
  ensureSeedPromise = (async () => {
    const users = await idbGetAll<StoredUser>(STORE_USERS);
    const defaultAdmin = users.find((u) => u.id === PRIMARY_ADMIN_ID);

    // Ensure only the single primary administrator account holds role === 'admin'
    for (const u of users) {
      if (u.id !== PRIMARY_ADMIN_ID) {
        if (u.login.trim().toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase()) {
          await idbDelete(STORE_USERS, u.id);
        } else if (u.role === 'admin') {
          await idbPut(STORE_USERS, { ...u, role: 'user' as UserRole });
        }
      }
    }

    if (!defaultAdmin) {
      const salt = randomSaltHex();
      const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD, salt);
      const adminUser: StoredUser = {
        id: PRIMARY_ADMIN_ID,
        name: 'Bosh Administrator',
        login: DEFAULT_ADMIN_LOGIN,
        role: 'admin',
        status: 'active',
        createdAt: new Date().toISOString(),
        passwordHash,
        passwordSalt: salt,
      };
      await idbPut(STORE_USERS, adminUser);
    } else if (
      defaultAdmin.login !== DEFAULT_ADMIN_LOGIN ||
      defaultAdmin.role !== 'admin' ||
      defaultAdmin.status !== 'active'
    ) {
      const salt = randomSaltHex();
      const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD, salt);
      await idbPut(STORE_USERS, {
        ...defaultAdmin,
        login: DEFAULT_ADMIN_LOGIN,
        role: 'admin',
        status: 'active',
        passwordHash,
        passwordSalt: salt,
      });
    }
  })();
  return ensureSeedPromise;
}

export async function getAuthStatusClient(): Promise<AuthStatusResponse> {
  await ensureDefaultAdminSeeded();
  const docs = await idbGetAll<LegalDocumentMeta>(STORE_DOCS);
  return {
    adminConfigured: true,
    envAdminActive: false,
    documentCount: docs.length,
  };
}

export async function authenticateClientUser(
  login: string,
  password: string
): Promise<{ token: string; user: UserPublic }> {
  await ensureDefaultAdminSeeded();
  const normalizedLogin = login.trim().toLowerCase();
  const users = await idbGetAll<StoredUser>(STORE_USERS);
  const found = users.find((u) => u.login.trim().toLowerCase() === normalizedLogin);

  if (!found) {
    throw new Error('INVALID_CREDENTIALS');
  }
  if (found.status === 'blocked') {
    throw new Error('ACCOUNT_BLOCKED');
  }

  const valid = await verifyPassword(password, found.passwordSalt, found.passwordHash);
  if (!valid) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const token = `prolex-session-${generateId()}`;
  persistSessionToken(token, found.id);
  return { token, user: toPublicUser(found) };
}

export async function restoreClientSession(): Promise<{
  token: string;
  user: UserPublic;
} | null> {
  await ensureDefaultAdminSeeded();
  return null;
}

export async function requireClientUser(token: string): Promise<UserPublic> {
  await ensureDefaultAdminSeeded();
  const userId = activeSessions.get(token);
  if (!userId) {
    throw new Error('UNAUTHORIZED');
  }
  const user = await idbGet<StoredUser>(STORE_USERS, userId);
  if (!user) {
    clearPersistedSession(token);
    throw new Error('UNAUTHORIZED');
  }
  if (user.status === 'blocked') {
    clearPersistedSession(token);
    throw new Error('ACCOUNT_BLOCKED');
  }
  return toPublicUser(user);
}

export async function requireClientAdmin(token: string): Promise<UserPublic> {
  const user = await requireClientUser(token);
  if (
    user.role !== 'admin' ||
    user.id !== PRIMARY_ADMIN_ID ||
    user.login.trim().toLowerCase() !== DEFAULT_ADMIN_LOGIN.toLowerCase()
  ) {
    throw new Error('FORBIDDEN');
  }
  return user;
}

export async function listClientUsers(token: string): Promise<UserPublic[]> {
  await requireClientAdmin(token);
  const users = await idbGetAll<StoredUser>(STORE_USERS);
  return users
    .map(toPublicUser)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function createClientUser(
  token: string,
  payload: { name: string; login: string; password: string }
): Promise<UserPublic> {
  await requireClientAdmin(token);
  const cleanName = payload.name.trim();
  const cleanLogin = payload.login.trim();

  if (cleanName.length < 2) {
    throw new Error('Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.');
  }
  if (cleanLogin.length < 3 || /\s/.test(cleanLogin)) {
    throw new Error(
      'Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.'
    );
  }
  if (payload.password.length < 6) {
    throw new Error('Parol kamida 6 ta belgidan iborat bo‘lishi kerak.');
  }

  const users = await idbGetAll<StoredUser>(STORE_USERS);
  const exists = users.some(
    (u) => u.login.trim().toLowerCase() === cleanLogin.toLowerCase()
  );
  if (exists) {
    throw new Error('Bu login allaqachon ro‘yxatda mavjud.');
  }

  const salt = randomSaltHex();
  const passwordHash = await hashPassword(payload.password, salt);

  const created: StoredUser = {
    id: generateId(),
    name: cleanName.slice(0, 120),
    login: cleanLogin.slice(0, 120),
    role: 'user',
    status: 'active',
    createdAt: new Date().toISOString(),
    passwordHash,
    passwordSalt: salt,
  };

  await idbPut(STORE_USERS, created);
  return toPublicUser(created);
}

export async function updateClientUserStatus(
  token: string,
  targetId: string,
  status: UserStatus
): Promise<UserPublic> {
  const admin = await requireClientAdmin(token);
  if (targetId === admin.id) {
    throw new Error('O‘z administrator hisobingizni bloklay olmaysiz.');
  }
  const target = await idbGet<StoredUser>(STORE_USERS, targetId);
  if (!target) {
    throw new Error('Foydalanuvchi topilmadi.');
  }
  if (target.role === 'admin') {
    throw new Error('Administrator hisobi holatini o‘zgartirish mumkin emas.');
  }
  const updated: StoredUser = { ...target, status };
  await idbPut(STORE_USERS, updated);
  return toPublicUser(updated);
}

export async function updateClientUser(
  token: string,
  targetId: string,
  payload: { name?: string; login?: string; password?: string }
): Promise<UserPublic> {
  await requireClientAdmin(token);
  const target = await idbGet<StoredUser>(STORE_USERS, targetId);
  if (!target) {
    throw new Error('Foydalanuvchi topilmadi.');
  }

  const nextName =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 120)
      : target.name;
  if (nextName.length < 2) {
    throw new Error('Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.');
  }

  const nextLogin =
    typeof payload.login === 'string' && payload.login.trim()
      ? payload.login.trim().slice(0, 120)
      : target.login;
  if (nextLogin.length < 3 || /\s/.test(nextLogin)) {
    throw new Error(
      'Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.'
    );
  }

  const users = await idbGetAll<StoredUser>(STORE_USERS);
  const duplicate = users.some(
    (u) =>
      u.id !== targetId &&
      u.login.trim().toLowerCase() === nextLogin.toLowerCase()
  );
  if (duplicate) {
    throw new Error('Bu login boshqa foydalanuvchi tomonidan band qilingan.');
  }

  let passwordHash = target.passwordHash;
  let passwordSalt = target.passwordSalt;
  if (typeof payload.password === 'string' && payload.password.length > 0) {
    if (payload.password.length < 6) {
      throw new Error('Yangi parol kamida 6 ta belgidan iborat bo‘lishi kerak.');
    }
    passwordSalt = randomSaltHex();
    passwordHash = await hashPassword(payload.password, passwordSalt);
  }

  const updated: StoredUser = {
    ...target,
    name: nextName,
    login: nextLogin,
    passwordHash,
    passwordSalt,
  };
  await idbPut(STORE_USERS, updated);
  return toPublicUser(updated);
}

export async function deleteClientUser(token: string, targetId: string): Promise<void> {
  const admin = await requireClientAdmin(token);
  if (targetId === admin.id) {
    throw new Error('O‘z administrator hisobingizni o‘chira olmaysiz.');
  }
  const target = await idbGet<StoredUser>(STORE_USERS, targetId);
  if (!target) {
    throw new Error('Foydalanuvchi topilmadi.');
  }
  if (target.role === 'admin') {
    throw new Error('Administrator hisobini o‘chirish mumkin emas.');
  }

  await idbDelete(STORE_USERS, targetId);

  // Cascade delete user's isolated chats
  const allChats = await idbGetAll<ChatSession>(STORE_CHATS);
  for (const chat of allChats) {
    if (chat.userId === targetId) {
      await idbDelete(STORE_CHATS, chat.id);
    }
  }
}

export async function updateAdminPasswordClient(
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const adminPublic = await requireClientAdmin(token);
  const admin = await idbGet<StoredUser>(STORE_USERS, adminPublic.id);
  if (!admin) throw new Error('Administrator topilmadi.');

  const valid = await verifyPassword(currentPassword, admin.passwordSalt, admin.passwordHash);
  if (!valid) {
    throw new Error('Joriy parol noto‘g‘ri.');
  }
  if (newPassword.length < 8) {
    throw new Error('Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
  }

  const salt = randomSaltHex();
  const passwordHash = await hashPassword(newPassword, salt);
  await idbPut(STORE_USERS, {
    ...admin,
    passwordSalt: salt,
    passwordHash,
  });
}

// Chats (Strictly userId-isolated)
export async function listClientUserChats(token: string): Promise<ChatSessionSummary[]> {
  const user = await requireClientUser(token);
  const all = await idbGetAll<ChatSession>(STORE_CHATS);
  return all
    .filter((c) => c.userId === user.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    }));
}

export async function createClientUserChat(
  token: string,
  title?: string
): Promise<ChatSession> {
  const user = await requireClientUser(token);
  const now = new Date().toISOString();
  const chat: ChatSession = {
    id: generateId(),
    userId: user.id,
    title: (title ?? '').trim().slice(0, 80) || 'Yangi huquqiy tahlil',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    messages: [],
  };
  await idbPut(STORE_CHATS, chat);
  return chat;
}

export async function getClientUserChat(
  token: string,
  chatId: string
): Promise<ChatSession> {
  const user = await requireClientUser(token);
  const chat = await idbGet<ChatSession>(STORE_CHATS, chatId);
  if (!chat || chat.userId !== user.id) {
    throw new Error('Suhbat topilmadi yoki sizga tegishli emas.');
  }
  return chat;
}

export async function deleteClientUserChat(
  token: string,
  chatId: string
): Promise<void> {
  const user = await requireClientUser(token);
  const chat = await idbGet<ChatSession>(STORE_CHATS, chatId);
  if (!chat || chat.userId !== user.id) {
    throw new Error('Suhbat topilmadi.');
  }
  await idbDelete(STORE_CHATS, chatId);
}

export async function appendClientChatMessages(
  token: string,
  chatId: string,
  newMessages: ChatMessage[],
  newTitle?: string
): Promise<ChatSession> {
  const user = await requireClientUser(token);
  const chat = await idbGet<ChatSession>(STORE_CHATS, chatId);
  if (!chat || chat.userId !== user.id) {
    throw new Error('Suhbat topilmadi yoki o‘chirilgan.');
  }
  const updated: ChatSession = {
    ...chat,
    title: newTitle ?? chat.title,
    updatedAt: new Date().toISOString(),
    messages: [...chat.messages, ...newMessages],
    messageCount: chat.messages.length + newMessages.length,
  };
  await idbPut(STORE_CHATS, updated);
  return updated;
}

// Documents (IndexedDB metadata + extracted text pages)
export async function listClientDocuments(token: string): Promise<LegalDocumentMeta[]> {
  await requireClientUser(token);
  const docs = await idbGetAll<LegalDocumentMeta>(STORE_DOCS);
  return docs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function addClientDocument(
  token: string,
  doc: Omit<LegalDocumentMeta, 'id' | 'createdAt' | 'uploadedBy'>,
  pages: string[]
): Promise<LegalDocumentMeta> {
  const admin = await requireClientAdmin(token);
  const docId = generateId();
  const saved: LegalDocumentMeta = {
    ...doc,
    id: docId,
    createdAt: new Date().toISOString(),
    uploadedBy: admin.name,
  };
  await idbPut(STORE_DOCS, saved);
  await idbPut(STORE_DOC_PAGES, { docId, pages } satisfies StoredDocPages);
  return saved;
}

export async function deleteClientDocument(token: string, docId: string): Promise<void> {
  await requireClientAdmin(token);
  const existing = await idbGet<LegalDocumentMeta>(STORE_DOCS, docId);
  if (!existing) {
    throw new Error('Huquqiy manba topilmadi.');
  }
  await idbDelete(STORE_DOCS, docId);
  await idbDelete(STORE_DOC_PAGES, docId);
}

export async function listIndexedDbDocuments(): Promise<LegalDocumentMeta[]> {
  const docs = await idbGetAll<LegalDocumentMeta>(STORE_DOCS);
  return docs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function addIndexedDbDocument(
  uploaderName: string,
  doc: Omit<LegalDocumentMeta, 'id' | 'createdAt' | 'uploadedBy'>,
  pages: string[]
): Promise<LegalDocumentMeta> {
  const docId = generateId();
  const saved: LegalDocumentMeta = {
    ...doc,
    id: docId,
    createdAt: new Date().toISOString(),
    uploadedBy: uploaderName,
  };
  await idbPut(STORE_DOCS, saved);
  await idbPut(STORE_DOC_PAGES, { docId, pages } satisfies StoredDocPages);
  return saved;
}

export async function deleteIndexedDbDocument(docId: string): Promise<void> {
  await idbDelete(STORE_DOCS, docId);
  await idbDelete(STORE_DOC_PAGES, docId);
}

export async function getClientDocumentPages(docId: string): Promise<string[] | null> {
  const stored = await idbGet<StoredDocPages>(STORE_DOC_PAGES, docId);
  return stored?.pages ?? null;
}

export function logoutClientSession(token: string | null): void {
  clearPersistedSession(token);
}
