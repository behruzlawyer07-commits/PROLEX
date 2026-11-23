import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
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
export const PRIMARY_ADMIN_ID = 'admin-default-prolex';

interface DbAppUserRow {
  id: string;
  username: string;
  password: string;
  role: string;
  full_name: string;
  status?: string | null;
  created_at: string;
}

interface DbChatHistoryRow {
  id: string;
  username: string;
  title: string;
  messages: unknown;
  updated_at: string;
}

interface DbDocumentRow {
  id: string;
  title: string;
  category: string;
  note: string;
  original_file_name: string;
  size_bytes: number | string;
  page_count: number;
  extracted_chars: number;
  indexed: boolean;
  uploaded_by: string;
  created_at: string;
}

function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (
    !url ||
    !anonKey ||
    url.startsWith('MY_') ||
    anonKey.startsWith('MY_') ||
    (!url.startsWith('https://') && !url.startsWith('http://'))
  ) {
    return null;
  }
  return { url, anonKey };
}

let cachedClient: SupabaseClient | null = null;
let cachedEnvSignature = '';

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

export function getSupabaseClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  if (!env) return null;
  const sig = `${env.url}::${env.anonKey}`;
  if (!cachedClient || cachedEnvSignature !== sig) {
    cachedClient = createClient(env.url, env.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedEnvSignature = sig;
  }
  return cachedClient;
}

function requireSupabaseClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase ulanmagan. Vercel Environment Variables ga VITE_SUPABASE_URL va VITE_SUPABASE_ANON_KEY qo‘shing.'
    );
  }
  return client;
}

function generateUuid(): string {
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
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function derivePbkdf2Hex(password: string, saltHex: string): Promise<string> {
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
      salt: enc.encode(saltHex),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPasswordForSupabase(password: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const salt = randomSaltHex(16);
    const hash = await derivePbkdf2Hex(password, salt);
    return `pbkdf2:${salt}:${hash}`;
  }
  throw new Error('Kriptografik shifrlash muhiti mavjud emas.');
}

export async function verifyPasswordAgainstSupabase(
  passwordInput: string,
  storedPassword: string
): Promise<boolean> {
  if (!storedPassword) return false;
  if (storedPassword.startsWith('pbkdf2:')) {
    const parts = storedPassword.split(':');
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const computedHex = await derivePbkdf2Hex(passwordInput, salt);
    return timingSafeEqualStr(computedHex, expectedHex);
  }
  // Supports manual SQL-inserted plaintext password rows as well
  return timingSafeEqualStr(passwordInput, storedPassword);
}

export function isPrimaryAdminUser(user: Pick<UserPublic, 'login' | 'role'> | null | undefined): boolean {
  if (!user) return false;
  return (
    user.role === 'admin' &&
    user.login.trim().toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase()
  );
}

function mapAppUserRow(row: DbAppUserRow): UserPublic {
  const isAdmin =
    row.username.trim().toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase() &&
    row.role === 'admin';
  const role: UserRole = isAdmin ? 'admin' : 'user';
  const status: UserStatus = row.status === 'blocked' ? 'blocked' : 'active';
  return {
    id: row.id,
    name: row.full_name || row.username,
    login: row.username,
    role,
    status,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message ?? '').toLowerCase();
  return err.code === '42703' || err.code === 'PGRST204' || msg.includes('column') && msg.includes('status');
}

function isMissingTableError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message ?? '').toLowerCase();
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

function formatSupabaseError(err: { message?: string; code?: string } | null, fallback: string): Error {
  if (!err) return new Error(fallback);
  if (isMissingTableError(err)) {
    return new Error(
      'Supabase bazasida kerakli jadval (app_users / chat_history) topilmadi. SQL Editor da jadval skriptini ishga tushiring.'
    );
  }
  if (err.code === '23505') {
    return new Error('Bu login allaqachon mavjud.');
  }
  return new Error(err.message || fallback);
}

let seededPromise: Promise<void> | null = null;

export async function ensurePrimaryAdminInSupabase(): Promise<void> {
  if (seededPromise) return seededPromise;

  seededPromise = (async () => {
    const client = requireSupabaseClient();
    const { data: existingAdmins, error: findErr } = await client
      .from('app_users')
      .select('id, username, password, role, full_name, created_at')
      .or(`username.ilike.${DEFAULT_ADMIN_LOGIN},role.eq.admin,id.eq.${PRIMARY_ADMIN_ID}`);

    if (findErr) {
      throw formatSupabaseError(findErr, 'Administrator ma’lumotlarini tekshirib bo‘lmadi.');
    }

    const rows = (existingAdmins ?? []) as DbAppUserRow[];
    let adminRow: DbAppUserRow | undefined;

    for (const row of rows) {
      if (row.username.trim().toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase()) {
        adminRow = row;
      } else if (row.id === PRIMARY_ADMIN_ID) {
        // Migrate legacy primary admin row (e.g., Uygun.uz) to Prolex@admin
        const hashed = await hashPasswordForSupabase(DEFAULT_ADMIN_PASSWORD);
        await client
          .from('app_users')
          .update({
            username: DEFAULT_ADMIN_LOGIN,
            password: hashed,
            role: 'admin',
            full_name: 'Bosh Administrator',
          })
          .eq('id', row.id);
        adminRow = {
          ...row,
          username: DEFAULT_ADMIN_LOGIN,
          password: hashed,
          role: 'admin',
          full_name: 'Bosh Administrator',
        };
      } else if (row.role === 'admin') {
        await client.from('app_users').update({ role: 'user' }).eq('id', row.id);
      }
    }

    if (!adminRow) {
      const hashed = await hashPasswordForSupabase(DEFAULT_ADMIN_PASSWORD);
      const baseInsert = {
        id: PRIMARY_ADMIN_ID,
        username: DEFAULT_ADMIN_LOGIN,
        password: hashed,
        role: 'admin',
        full_name: 'Bosh Administrator',
      };
      const withStatus = await client
        .from('app_users')
        .insert({ ...baseInsert, status: 'active' });
      if (withStatus.error && isMissingColumnError(withStatus.error)) {
        const retry = await client.from('app_users').insert(baseInsert);
        if (retry.error && retry.error.code !== '23505') {
          throw formatSupabaseError(retry.error, 'Bosh administratorni yaratib bo‘lmadi.');
        }
      } else if (withStatus.error && withStatus.error.code !== '23505') {
        throw formatSupabaseError(withStatus.error, 'Bosh administratorni yaratib bo‘lmadi.');
      }
    } else if (adminRow.role !== 'admin') {
      await client.from('app_users').update({ role: 'admin' }).eq('id', adminRow.id);
    }
  })().catch((err) => {
    seededPromise = null;
    throw err;
  });

  return seededPromise;
}

export async function authenticateSupabaseUser(
  loginInput: string,
  passwordInput: string
): Promise<UserPublic> {
  const cleanLogin = loginInput.trim();
  if (!cleanLogin || !passwordInput) {
    throw new Error('INVALID_CREDENTIALS');
  }

  await ensurePrimaryAdminInSupabase();
  const client = requireSupabaseClient();

  const { data, error } = await client
    .from('app_users')
    .select('*')
    .ilike('username', cleanLogin)
    .limit(1);

  if (error) {
    throw formatSupabaseError(error, 'Login ma’lumotlarini tekshirishda xatolik.');
  }

  const row = (data?.[0] ?? null) as DbAppUserRow | null;
  if (!row) {
    throw new Error('INVALID_CREDENTIALS');
  }

  if (row.status === 'blocked') {
    throw new Error('ACCOUNT_BLOCKED');
  }

  const ok = await verifyPasswordAgainstSupabase(passwordInput, row.password);
  if (!ok) {
    throw new Error('INVALID_CREDENTIALS');
  }

  return mapAppUserRow(row);
}

export async function getSupabaseUserById(userId: string): Promise<UserPublic | null> {
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('app_users')
    .select('*')
    .eq('id', userId)
    .limit(1);
  if (error || !data?.[0]) return null;
  const user = mapAppUserRow(data[0] as DbAppUserRow);
  if (user.status === 'blocked') return null;
  return user;
}

export async function listSupabaseUsers(sessionUser: UserPublic): Promise<UserPublic[]> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }
  await ensurePrimaryAdminInSupabase();
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('app_users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw formatSupabaseError(error, 'Foydalanuvchilar ro‘yxatini yuklab bo‘lmadi.');
  }

  return ((data ?? []) as DbAppUserRow[]).map(mapAppUserRow);
}

export async function createSupabaseUser(
  sessionUser: UserPublic,
  payload: { name: string; login: string; password: string }
): Promise<UserPublic> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }

  const cleanName = payload.name.trim();
  const cleanLogin = payload.login.trim();
  const password = payload.password;

  if (cleanName.length < 2) {
    throw new Error('Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.');
  }
  if (cleanLogin.length < 3 || /\s/.test(cleanLogin)) {
    throw new Error('Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.');
  }
  if (cleanLogin.toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase()) {
    throw new Error('Bu login bosh administrator uchun band qilingan.');
  }
  if (password.length < 6) {
    throw new Error('Parol kamida 6 ta belgidan iborat bo‘lishi kerak.');
  }

  const client = requireSupabaseClient();
  const { data: dupRows } = await client
    .from('app_users')
    .select('id')
    .ilike('username', cleanLogin)
    .limit(1);

  if (dupRows && dupRows.length > 0) {
    throw new Error('Bu login allaqachon ro‘yxatda mavjud.');
  }

  const passwordHash = await hashPasswordForSupabase(password);
  const newId = generateUuid();
  const baseRow = {
    id: newId,
    username: cleanLogin.slice(0, 120),
    password: passwordHash,
    role: 'user',
    full_name: cleanName.slice(0, 120),
  };

  let res = await client
    .from('app_users')
    .insert({ ...baseRow, status: 'active' })
    .select('*')
    .single();

  if (res.error && isMissingColumnError(res.error)) {
    res = await client.from('app_users').insert(baseRow).select('*').single();
  }

  if (res.error || !res.data) {
    throw formatSupabaseError(res.error, 'Foydalanuvchi qo‘shib bo‘lmadi.');
  }

  return mapAppUserRow(res.data as DbAppUserRow);
}

export async function updateSupabaseUser(
  sessionUser: UserPublic,
  targetId: string,
  payload: { name?: string; login?: string; password?: string }
): Promise<UserPublic> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }

  const client = requireSupabaseClient();
  const { data: targetRows, error: findErr } = await client
    .from('app_users')
    .select('*')
    .eq('id', targetId)
    .limit(1);

  if (findErr) {
    throw formatSupabaseError(findErr, 'Foydalanuvchini topib bo‘lmadi.');
  }
  const target = (targetRows?.[0] ?? null) as DbAppUserRow | null;
  if (!target) {
    throw new Error('Foydalanuvchi topilmadi.');
  }

  const nextName =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 120)
      : target.full_name;
  if (nextName.length < 2) {
    throw new Error('Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.');
  }

  const nextLogin =
    typeof payload.login === 'string' && payload.login.trim()
      ? payload.login.trim().slice(0, 120)
      : target.username;
  if (nextLogin.length < 3 || /\s/.test(nextLogin)) {
    throw new Error('Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.');
  }

  if (
    target.username.trim().toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase() &&
    nextLogin.toLowerCase() !== target.username.trim().toLowerCase()
  ) {
    throw new Error('Asosiy administrator loginini o‘zgartirib bo‘lmaydi.');
  }

  const { data: dupRows } = await client
    .from('app_users')
    .select('id')
    .ilike('username', nextLogin)
    .neq('id', targetId)
    .limit(1);

  if (dupRows && dupRows.length > 0) {
    throw new Error('Bu login boshqa foydalanuvchi tomonidan band qilingan.');
  }

  const updates: Record<string, unknown> = {
    full_name: nextName,
    username: nextLogin,
  };

  if (typeof payload.password === 'string' && payload.password.length > 0) {
    if (payload.password.length < 6) {
      throw new Error('Yangi parol kamida 6 ta belgidan iborat bo‘lishi kerak.');
    }
    updates.password = await hashPasswordForSupabase(payload.password);
  }

  const { data: updated, error: upErr } = await client
    .from('app_users')
    .update(updates)
    .eq('id', targetId)
    .select('*')
    .single();

  if (upErr || !updated) {
    throw formatSupabaseError(upErr, 'Foydalanuvchi ma’lumotlarini yangilab bo‘lmadi.');
  }

  // Keep chat_history username synchronized if login changed
  if (nextLogin.toLowerCase() !== target.username.trim().toLowerCase()) {
    await client
      .from('chat_history')
      .update({ username: nextLogin })
      .ilike('username', target.username);
  }

  return mapAppUserRow(updated as DbAppUserRow);
}

export async function updateSupabaseUserStatus(
  sessionUser: UserPublic,
  targetId: string,
  status: UserStatus
): Promise<UserPublic> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }
  if (targetId === sessionUser.id) {
    throw new Error('O‘z administrator hisobingizni bloklay olmaysiz.');
  }

  const client = requireSupabaseClient();
  const { data: targetRows } = await client
    .from('app_users')
    .select('*')
    .eq('id', targetId)
    .limit(1);
  const target = (targetRows?.[0] ?? null) as DbAppUserRow | null;
  if (!target) {
    throw new Error('Foydalanuvchi topilmadi.');
  }
  if (
    target.role === 'admin' ||
    target.username.trim().toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase()
  ) {
    throw new Error('Administrator hisobi holatini o‘zgartirish mumkin emas.');
  }

  const { data: updated, error } = await client
    .from('app_users')
    .update({ status })
    .eq('id', targetId)
    .select('*')
    .single();

  if (error) {
    if (isMissingColumnError(error)) {
      throw new Error('app_users jadvalida status ustuni mavjud emas (supabase/schema.sql ni yangilang).');
    }
    throw formatSupabaseError(error, 'Holatni o‘zgartirishda xatolik.');
  }

  return mapAppUserRow(updated as DbAppUserRow);
}

export async function deleteSupabaseUser(
  sessionUser: UserPublic,
  targetId: string
): Promise<void> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }
  if (targetId === sessionUser.id) {
    throw new Error('O‘z administrator hisobingizni o‘chira olmaysiz.');
  }

  const client = requireSupabaseClient();
  const { data: targetRows } = await client
    .from('app_users')
    .select('*')
    .eq('id', targetId)
    .limit(1);
  const target = (targetRows?.[0] ?? null) as DbAppUserRow | null;
  if (!target) {
    throw new Error('Foydalanuvchi topilmadi.');
  }
  if (
    target.role === 'admin' ||
    target.username.trim().toLowerCase() === DEFAULT_ADMIN_LOGIN.toLowerCase()
  ) {
    throw new Error('Administrator hisobini o‘chirish mumkin emas.');
  }

  const { error } = await client.from('app_users').delete().eq('id', targetId);
  if (error) {
    throw formatSupabaseError(error, 'Foydalanuvchini o‘chirib bo‘lmadi.');
  }

  await client.from('chat_history').delete().ilike('username', target.username);
}

export async function updateSupabaseAdminPassword(
  sessionUser: UserPublic,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }
  const client = requireSupabaseClient();
  const { data: rows, error } = await client
    .from('app_users')
    .select('*')
    .ilike('username', DEFAULT_ADMIN_LOGIN)
    .limit(1);

  if (error || !rows?.[0]) {
    throw new Error('Administrator hisobi topilmadi.');
  }
  const adminRow = rows[0] as DbAppUserRow;
  const ok = await verifyPasswordAgainstSupabase(currentPassword, adminRow.password);
  if (!ok) {
    throw new Error('Joriy parol noto‘g‘ri.');
  }
  if (newPassword.length < 8) {
    throw new Error('Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
  }

  const newHash = await hashPasswordForSupabase(newPassword);
  const { error: upErr } = await client
    .from('app_users')
    .update({ password: newHash })
    .eq('id', adminRow.id);

  if (upErr) {
    throw formatSupabaseError(upErr, 'Administrator parolini yangilab bo‘lmadi.');
  }
}

// --- Chat History (Supabase `chat_history` table) ---

function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is ChatMessage => Boolean(m && typeof m === 'object'));
}

function mapChatSummary(row: DbChatHistoryRow): ChatSessionSummary {
  const msgs = normalizeMessages(row.messages);
  return {
    id: row.id,
    title: row.title || 'Yangi huquqiy tahlil',
    createdAt: msgs[0]?.createdAt || row.updated_at,
    updatedAt: row.updated_at,
    messageCount: msgs.length,
  };
}

function mapChatSession(row: DbChatHistoryRow, userId: string): ChatSession {
  const msgs = normalizeMessages(row.messages);
  return {
    id: row.id,
    userId,
    title: row.title || 'Yangi huquqiy tahlil',
    createdAt: msgs[0]?.createdAt || row.updated_at,
    updatedAt: row.updated_at,
    messageCount: msgs.length,
    messages: msgs,
  };
}

export async function listSupabaseChats(sessionUser: UserPublic): Promise<ChatSessionSummary[]> {
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('chat_history')
    .select('id, username, title, messages, updated_at')
    .ilike('username', sessionUser.login)
    .order('updated_at', { ascending: false });

  if (error) {
    throw formatSupabaseError(error, 'Yozishmalar tarixini yuklab bo‘lmadi.');
  }

  return ((data ?? []) as DbChatHistoryRow[]).map(mapChatSummary);
}

export async function createSupabaseChat(
  sessionUser: UserPublic,
  title?: string
): Promise<ChatSession> {
  const client = requireSupabaseClient();
  const now = new Date().toISOString();
  const cleanTitle = (title ?? '').trim().slice(0, 80) || 'Yangi huquqiy tahlil';
  const id = generateUuid();

  const { data, error } = await client
    .from('chat_history')
    .insert({
      id,
      username: sessionUser.login,
      title: cleanTitle,
      messages: [],
      updated_at: now,
    })
    .select('id, username, title, messages, updated_at')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Yangi suhbat ochib bo‘lmadi.');
  }

  return mapChatSession(data as DbChatHistoryRow, sessionUser.id);
}

export async function getSupabaseChat(
  sessionUser: UserPublic,
  chatId: string
): Promise<ChatSession> {
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('chat_history')
    .select('id, username, title, messages, updated_at')
    .eq('id', chatId)
    .ilike('username', sessionUser.login)
    .limit(1);

  if (error) {
    throw formatSupabaseError(error, 'Suhbatni o‘qishda xatolik.');
  }
  const row = (data?.[0] ?? null) as DbChatHistoryRow | null;
  if (!row) {
    throw new Error('Suhbat topilmadi yoki sizga tegishli emas.');
  }
  return mapChatSession(row, sessionUser.id);
}

export async function appendSupabaseChatMessages(
  sessionUser: UserPublic,
  chatId: string,
  newMessages: ChatMessage[],
  newTitle?: string
): Promise<ChatSession> {
  const client = requireSupabaseClient();
  const current = await getSupabaseChat(sessionUser, chatId);
  const merged = [...current.messages, ...newMessages];
  const now = new Date().toISOString();

  const { data, error } = await client
    .from('chat_history')
    .update({
      title: newTitle?.trim().slice(0, 80) || current.title,
      messages: merged,
      updated_at: now,
    })
    .eq('id', chatId)
    .ilike('username', sessionUser.login)
    .select('id, username, title, messages, updated_at')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Yozishmalarni saqlab bo‘lmadi.');
  }

  return mapChatSession(data as DbChatHistoryRow, sessionUser.id);
}

export async function deleteSupabaseChat(
  sessionUser: UserPublic,
  chatId: string
): Promise<void> {
  const client = requireSupabaseClient();
  const { error } = await client
    .from('chat_history')
    .delete()
    .eq('id', chatId)
    .ilike('username', sessionUser.login);

  if (error) {
    throw formatSupabaseError(error, 'Suhbatni o‘chirishda xatolik.');
  }
}

// --- Optional Cross-Device PDF Documents (`prolex_documents` & `prolex_doc_pages`) ---

function mapDocumentMeta(row: DbDocumentRow): LegalDocumentMeta {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    note: row.note ?? '',
    originalFileName: row.original_file_name,
    sizeBytes: Number(row.size_bytes) || 0,
    pageCount: Number(row.page_count) || 0,
    extractedChars: Number(row.extracted_chars) || 0,
    indexed: Boolean(row.indexed),
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by,
  };
}

export async function listSupabaseDocuments(): Promise<LegalDocumentMeta[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('prolex_documents')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return null;
    throw formatSupabaseError(error, 'PDF hujjatlarni yuklab bo‘lmadi.');
  }

  return ((data ?? []) as DbDocumentRow[]).map(mapDocumentMeta);
}

export async function saveSupabaseDocument(
  sessionUser: UserPublic,
  meta: Omit<LegalDocumentMeta, 'id' | 'createdAt' | 'uploadedBy'>,
  pages: string[]
): Promise<LegalDocumentMeta | null> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }
  const client = getSupabaseClient();
  if (!client) return null;

  const docId = generateUuid();
  const { data, error } = await client
    .from('prolex_documents')
    .insert({
      id: docId,
      title: meta.title,
      category: meta.category,
      note: meta.note,
      original_file_name: meta.originalFileName,
      size_bytes: meta.sizeBytes,
      page_count: meta.pageCount,
      extracted_chars: meta.extractedChars,
      indexed: meta.indexed,
      uploaded_by: sessionUser.name,
    })
    .select('*')
    .single();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw formatSupabaseError(error, 'PDF hujjatni saqlab bo‘lmadi.');
  }

  const { error: pagesErr } = await client.from('prolex_doc_pages').insert({
    doc_id: docId,
    pages,
  });
  if (pagesErr) {
    await client.from('prolex_documents').delete().eq('id', docId);
    if (isMissingTableError(pagesErr)) return null;
    throw formatSupabaseError(pagesErr, 'PDF sahifalarini saqlab bo‘lmadi.');
  }

  return mapDocumentMeta(data as DbDocumentRow);
}

export async function getSupabaseDocumentPages(docId: string): Promise<string[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('prolex_doc_pages')
    .select('pages')
    .eq('doc_id', docId)
    .limit(1);

  if (error || !data?.[0]) return null;
  const raw = (data[0] as { pages?: unknown }).pages;
  return Array.isArray(raw) ? raw.map(String) : [];
}

export async function deleteSupabaseDocument(
  sessionUser: UserPublic,
  docId: string
): Promise<boolean> {
  if (!isPrimaryAdminUser(sessionUser)) {
    throw new Error('FORBIDDEN');
  }
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from('prolex_documents').delete().eq('id', docId);
  if (error) {
    if (isMissingTableError(error)) return false;
    throw formatSupabaseError(error, 'PDF hujjatni o‘chirib bo‘lmadi.');
  }
  return true;
}
