import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ChatMessage,
  ChatSession,
  LegalDocumentMeta,
  UserPublic,
  UserRole,
  UserStatus,
} from '../src/types/sherlex.ts';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const EXTRACTED_DIR = path.join(DATA_DIR, 'extracted');
const DB_FILE = path.join(DATA_DIR, 'sherlex-db.json');

export interface StoredUser extends UserPublic {
  passwordHash: string;
}

export interface StoredLegalDocument extends LegalDocumentMeta {
  storedFileName: string;
  geminiFileUri?: string;
  geminiFileMimeType?: string;
  geminiFileUploadedAt?: string;
}

interface DatabaseSchema {
  users: StoredUser[];
  documents: StoredLegalDocument[];
  chats: ChatSession[];
}

function ensureDirectories(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
}

function readDbFromDisk(): DatabaseSchema {
  ensureDirectories();
  if (!fs.existsSync(DB_FILE)) {
    const initial: DatabaseSchema = { users: [], documents: [], chats: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      chats: Array.isArray(parsed.chats) ? parsed.chats : [],
    };
  } catch {
    return { users: [], documents: [], chats: [] };
  }
}

let dbCache: DatabaseSchema = readDbFromDisk();
let writeChain: Promise<void> = Promise.resolve();

function persistDb(): Promise<void> {
  const snapshot = JSON.stringify(dbCache, null, 2);
  writeChain = writeChain.then(async () => {
    ensureDirectories();
    const tmpFile = `${DB_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.promises.writeFile(tmpFile, snapshot, 'utf8');
    await fs.promises.rename(tmpFile, DB_FILE);
  });
  return writeChain;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(password, salt, 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function constantTimeStringCompare(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function toPublicUser(user: StoredUser): UserPublic {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export function toPublicDocument(doc: StoredLegalDocument): LegalDocumentMeta {
  return {
    id: doc.id,
    title: doc.title,
    category: doc.category,
    note: doc.note,
    originalFileName: doc.originalFileName,
    sizeBytes: doc.sizeBytes,
    pageCount: doc.pageCount,
    extractedChars: doc.extractedChars,
    indexed: doc.indexed,
    createdAt: doc.createdAt,
    uploadedBy: doc.uploadedBy,
  };
}

export function getEnvAdminConfig(): { login: string; passcode: string } | null {
  const passcode = (process.env.ADMIN_PASSCODE ?? '').trim();
  if (!passcode) return null;
  const login = (process.env.ADMIN_LOGIN ?? 'admin@sherlex.uz').trim().toLowerCase();
  return { login, passcode };
}

export function isAdminConfigured(): boolean {
  if (getEnvAdminConfig()) return true;
  return dbCache.users.some((u) => u.role === 'admin');
}

export async function bootstrapAdmin(name: string, login: string, password: string): Promise<UserPublic> {
  if (isAdminConfigured()) {
    throw new Error('ADMIN_ALREADY_CONFIGURED');
  }
  const normalizedLogin = login.trim().toLowerCase();
  if (dbCache.users.some((u) => u.login === normalizedLogin)) {
    throw new Error('LOGIN_EXISTS');
  }
  const admin: StoredUser = {
    id: crypto.randomUUID(),
    name: name.trim(),
    login: normalizedLogin,
    passwordHash: hashPassword(password),
    role: 'admin',
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  dbCache.users.push(admin);
  await persistDb();
  return toPublicUser(admin);
}

export async function authenticateUser(
  login: string,
  password: string
): Promise<{ user: UserPublic } | { error: 'INVALID_CREDENTIALS' | 'ACCOUNT_BLOCKED' }> {
  const normalizedLogin = login.trim().toLowerCase();
  const envAdmin = getEnvAdminConfig();

  if (envAdmin && constantTimeStringCompare(normalizedLogin, envAdmin.login)) {
    if (!constantTimeStringCompare(password, envAdmin.passcode)) {
      return { error: 'INVALID_CREDENTIALS' };
    }
    let adminRecord = dbCache.users.find((u) => u.login === envAdmin.login && u.role === 'admin');
    if (!adminRecord) {
      adminRecord = {
        id: 'env-admin',
        name: 'Tizim Administratori',
        login: envAdmin.login,
        passwordHash: '',
        role: 'admin',
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      dbCache.users.push(adminRecord);
      await persistDb();
    }
    if (adminRecord.status === 'blocked') {
      return { error: 'ACCOUNT_BLOCKED' };
    }
    return { user: toPublicUser(adminRecord) };
  }

  const found = dbCache.users.find((u) => u.login === normalizedLogin);
  if (!found || !found.passwordHash) {
    return { error: 'INVALID_CREDENTIALS' };
  }
  if (!verifyPasswordHash(password, found.passwordHash)) {
    return { error: 'INVALID_CREDENTIALS' };
  }
  if (found.status === 'blocked') {
    return { error: 'ACCOUNT_BLOCKED' };
  }
  return { user: toPublicUser(found) };
}

export function getUserById(userId: string): UserPublic | null {
  const found = dbCache.users.find((u) => u.id === userId);
  return found ? toPublicUser(found) : null;
}

export function listUsers(): UserPublic[] {
  return dbCache.users
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toPublicUser);
}

export async function createUserAccount(params: {
  name: string;
  login: string;
  password: string;
  role?: UserRole;
}): Promise<UserPublic> {
  const normalizedLogin = params.login.trim().toLowerCase();
  const envAdmin = getEnvAdminConfig();
  if (
    dbCache.users.some((u) => u.login === normalizedLogin) ||
    (envAdmin && envAdmin.login === normalizedLogin)
  ) {
    throw new Error('LOGIN_EXISTS');
  }

  const user: StoredUser = {
    id: crypto.randomUUID(),
    name: params.name.trim(),
    login: normalizedLogin,
    passwordHash: hashPassword(params.password),
    role: params.role ?? 'user',
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  dbCache.users.push(user);
  await persistDb();
  return toPublicUser(user);
}

export async function updateUserStatus(userId: string, status: UserStatus): Promise<UserPublic | null> {
  const found = dbCache.users.find((u) => u.id === userId);
  if (!found) return null;
  found.status = status;
  await persistDb();
  return toPublicUser(found);
}

export async function deleteUserAccount(userId: string): Promise<boolean> {
  const idx = dbCache.users.findIndex((u) => u.id === userId);
  if (idx === -1) return false;
  dbCache.users.splice(idx, 1);
  dbCache.chats = dbCache.chats.filter((c) => c.userId !== userId);
  await persistDb();
  return true;
}

// Legal Documents Management
export function listStoredDocuments(): StoredLegalDocument[] {
  return dbCache.documents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getStoredDocument(docId: string): StoredLegalDocument | null {
  return dbCache.documents.find((d) => d.id === docId) ?? null;
}

export async function addStoredDocument(doc: StoredLegalDocument): Promise<LegalDocumentMeta> {
  dbCache.documents.push(doc);
  await persistDb();
  return toPublicDocument(doc);
}

export async function updateDocumentGeminiFile(
  docId: string,
  geminiFileUri: string,
  geminiFileMimeType: string
): Promise<void> {
  const doc = dbCache.documents.find((d) => d.id === docId);
  if (!doc) return;
  doc.geminiFileUri = geminiFileUri;
  doc.geminiFileMimeType = geminiFileMimeType;
  doc.geminiFileUploadedAt = new Date().toISOString();
  await persistDb();
}

export async function deleteStoredDocument(docId: string): Promise<StoredLegalDocument | null> {
  const idx = dbCache.documents.findIndex((d) => d.id === docId);
  if (idx === -1) return null;
  const [removed] = dbCache.documents.splice(idx, 1);
  await persistDb();
  return removed;
}

// User-Isolated Chats Management
export function listUserChats(userId: string) {
  return dbCache.chats
    .filter((c) => c.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    }));
}

export function getUserChat(userId: string, chatId: string): ChatSession | null {
  const chat = dbCache.chats.find((c) => c.id === chatId && c.userId === userId);
  return chat ? structuredClone(chat) : null;
}

export async function createUserChat(userId: string, title = 'Yangi huquqiy tahlil'): Promise<ChatSession> {
  const now = new Date().toISOString();
  const chat: ChatSession = {
    id: crypto.randomUUID(),
    userId,
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    messages: [],
  };
  dbCache.chats.push(chat);
  await persistDb();
  return structuredClone(chat);
}

export async function appendChatMessages(
  userId: string,
  chatId: string,
  messages: ChatMessage[],
  newTitle?: string
): Promise<ChatSession | null> {
  const chat = dbCache.chats.find((c) => c.id === chatId && c.userId === userId);
  if (!chat) return null;
  chat.messages.push(...messages);
  chat.messageCount = chat.messages.length;
  chat.updatedAt = new Date().toISOString();
  if (newTitle) {
    chat.title = newTitle;
  }
  await persistDb();
  return structuredClone(chat);
}

export async function deleteUserChat(userId: string, chatId: string): Promise<boolean> {
  const idx = dbCache.chats.findIndex((c) => c.id === chatId && c.userId === userId);
  if (idx === -1) return false;
  dbCache.chats.splice(idx, 1);
  await persistDb();
  return true;
}
