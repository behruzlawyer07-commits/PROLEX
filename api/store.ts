import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

type UserRole = 'admin' | 'user';
type UserStatus = 'active' | 'blocked';

interface UserPublic {
  id: string;
  name: string;
  login: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

interface DbUserRow {
  id: string;
  name: string;
  login: string;
  role: UserRole;
  status: UserStatus;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: Array<{ title: string; url: string }>;
  referencedPdfs?: string[];
}

interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ChatSession extends ChatSessionSummary {
  userId: string;
  messages: ChatMessage[];
}

interface DbChatRow {
  id: string;
  user_id: string;
  title: string;
  messages: ChatMessage[];
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface LegalDocumentMeta {
  id: string;
  title: string;
  category: string;
  note: string;
  originalFileName: string;
  sizeBytes: number;
  pageCount: number;
  extractedChars: number;
  indexed: boolean;
  createdAt: string;
  uploadedBy: string;
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

interface DbDocPagesRow {
  doc_id: string;
  pages: string[];
}

interface DbSessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
}

interface VercelLikeRequest extends IncomingMessage {
  method?: string;
  url?: string;
  body?: unknown;
  query?: Record<string, unknown>;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (payload: unknown) => void;
}

const PRIMARY_ADMIN_ID = 'admin-default-prolex';
const COOKIE_NAME = 'prolex_session';

function getPrimaryAdminLogin(): string {
  const envVal = process.env.ADMIN_LOGIN?.trim();
  return envVal && envVal.length >= 3 ? envVal : 'Prolex@admin';
}

function getPrimaryAdminPassword(): string {
  const envVal = process.env.ADMIN_PASSWORD;
  return envVal && envVal.length >= 6 ? envVal : '00081187';
}

function getSupabaseConfig(): { url: string; serviceKey: string } | null {
  const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (
    !url ||
    !serviceKey ||
    url.startsWith('MY_') ||
    serviceKey.startsWith('MY_')
  ) {
    return null;
  }
  return { url, serviceKey };
}

async function sbFetch<T>(
  cfg: { url: string; serviceKey: string },
  pathAndQuery: string,
  init: {
    method?: string;
    body?: unknown;
    prefer?: string;
  } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const headers: Record<string, string> = {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      'Content-Type': 'application/json',
    };
    if (init.prefer) {
      headers.Prefer = init.prefer;
    }

    const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const msg =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `Supabase xatoligi (${res.status})`;
      throw new Error(`DB_ERROR:${msg}`);
    }

    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

function hashPasswordScrypt(password: string, salt: string): string {
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt:${derived.toString('hex')}`;
}

function verifyPasswordScrypt(password: string, salt: string, storedHash: string): boolean {
  const expected = hashPasswordScrypt(password, salt);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toPublicUser(row: DbUserRow): UserPublic {
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toChatSummary(row: DbChatRow): ChatSessionSummary {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: messages.length || Number(row.message_count) || 0,
  };
}

function toChatSession(row: DbChatRow): ChatSession {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: messages.length || Number(row.message_count) || 0,
    messages,
  };
}

function toDocumentMeta(row: DbDocumentRow): LegalDocumentMeta {
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

async function ensurePrimaryAdminSeeded(cfg: { url: string; serviceKey: string }): Promise<void> {
  const adminLogin = getPrimaryAdminLogin();
  const adminPass = getPrimaryAdminPassword();

  const allAdminsOrConflict = await sbFetch<DbUserRow[]>(
    cfg,
    `prolex_users?or=(id.eq.${encodeURIComponent(
      PRIMARY_ADMIN_ID
    )},role.eq.admin,login_lower.eq.${encodeURIComponent(
      adminLogin.trim().toLowerCase()
    )})&select=id,name,login,role,status,password_hash,password_salt,created_at`
  );

  let primaryRow: DbUserRow | undefined;

  for (const row of allAdminsOrConflict) {
    if (row.id === PRIMARY_ADMIN_ID) {
      primaryRow = row;
    } else if (row.login.trim().toLowerCase() === adminLogin.trim().toLowerCase()) {
      await sbFetch(cfg, `prolex_users?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
    } else if (row.role === 'admin') {
      await sbFetch(cfg, `prolex_users?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: { role: 'user' },
      });
    }
  }

  if (!primaryRow) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPasswordScrypt(adminPass, salt);
    await sbFetch(cfg, 'prolex_users', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        id: PRIMARY_ADMIN_ID,
        name: 'Bosh Administrator',
        login: adminLogin,
        role: 'admin',
        status: 'active',
        password_hash: passwordHash,
        password_salt: salt,
      },
    });
  } else if (
    primaryRow.login.trim().toLowerCase() !== adminLogin.trim().toLowerCase() ||
    primaryRow.role !== 'admin' ||
    primaryRow.status !== 'active'
  ) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPasswordScrypt(adminPass, salt);
    await sbFetch(cfg, `prolex_users?id=eq.${encodeURIComponent(PRIMARY_ADMIN_ID)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        login: adminLogin,
        role: 'admin',
        status: 'active',
        password_hash: passwordHash,
        password_salt: salt,
      },
    });
  }
}

function parseCookies(req: VercelLikeRequest): Record<string, string> {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function extractSessionToken(req: VercelLikeRequest): { token: string | null; fromCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return { token: t, fromCookie: false };
  }
  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME]) {
    return { token: cookies[COOKIE_NAME], fromCookie: true };
  }
  return { token: null, fromCookie: false };
}

function isHttpsRequest(req: VercelLikeRequest): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.includes('https')) return true;
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function setSessionCookie(res: VercelLikeResponse, req: VercelLikeRequest, token: string): void {
  const secure = isHttpsRequest(req);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Max-Age=2592000',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    ...(secure ? ['Secure', 'Partitioned'] : []),
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res: VercelLikeResponse, req: VercelLikeRequest): void {
  const secure = isHttpsRequest(req);
  const attrs = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    ...(secure ? ['Secure', 'Partitioned'] : []),
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function isSameOriginMutationAllowed(req: VercelLikeRequest): boolean {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHost = String(
      req.headers['x-forwarded-host'] || req.headers.host || ''
    )
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (!expectedHost) return true;
    return originHost === expectedHost;
  } catch {
    return false;
  }
}

async function requireCloudUser(
  cfg: { url: string; serviceKey: string },
  token: string | null
): Promise<UserPublic> {
  if (!token) {
    throw new Error('UNAUTHORIZED');
  }
  const tokenHash = sha256Hex(token);
  const sessions = await sbFetch<DbSessionRow[]>(
    cfg,
    `prolex_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&select=token_hash,user_id,expires_at`
  );
  const session = sessions[0];
  if (!session) {
    throw new Error('UNAUTHORIZED');
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    await sbFetch(cfg, `prolex_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
      method: 'DELETE',
    });
    throw new Error('UNAUTHORIZED');
  }

  const users = await sbFetch<DbUserRow[]>(
    cfg,
    `prolex_users?id=eq.${encodeURIComponent(session.user_id)}&select=id,name,login,role,status,password_hash,password_salt,created_at`
  );
  const user = users[0];
  if (!user) {
    throw new Error('UNAUTHORIZED');
  }
  if (user.status === 'blocked') {
    throw new Error('ACCOUNT_BLOCKED');
  }
  return toPublicUser(user);
}

async function requireCloudAdmin(
  cfg: { url: string; serviceKey: string },
  token: string | null
): Promise<UserPublic> {
  const user = await requireCloudUser(cfg, token);
  const adminLogin = getPrimaryAdminLogin().trim().toLowerCase();
  if (
    user.role !== 'admin' ||
    user.id !== PRIMARY_ADMIN_ID ||
    user.login.trim().toLowerCase() !== adminLogin
  ) {
    throw new Error('FORBIDDEN');
  }
  return user;
}

function searchExcerptsInPages(
  query: string,
  docs: LegalDocumentMeta[],
  pagesByDocId: Map<string, string[]>
): {
  catalogSummary: string;
  matches: Array<{
    docId: string;
    title: string;
    category: string;
    note: string;
    pageNumber: number;
    excerpt: string;
  }>;
} {
  if (docs.length === 0) {
    return { catalogSummary: '', matches: [] };
  }

  const catalogSummary = docs
    .map(
      (d, idx) =>
        `${idx + 1}. "${d.title}" [${d.category}] (${d.pageCount} sahifa)${
          d.note ? ` — ${d.note}` : ''
        }`
    )
    .join('\n');

  const rawTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff‘’'\-\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const uniqueTokens = Array.from(new Set(rawTokens)).slice(0, 24);
  const scored: Array<{
    doc: LegalDocumentMeta;
    pageNumber: number;
    pageText: string;
    score: number;
  }> = [];

  for (const doc of docs) {
    const pages = pagesByDocId.get(doc.id);
    if (!pages || pages.length === 0) continue;

    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i];
      if (!pageText || pageText.length < 20) continue;
      const lower = pageText.toLowerCase();
      let score = 0;
      for (const tok of uniqueTokens) {
        if (lower.includes(tok)) {
          score += tok.length >= 6 ? 3 : 2;
        }
      }
      if (/\b\d{1,3}-modda\b/i.test(query) && /\b\d{1,3}-modda\b/i.test(pageText)) {
        score += 2;
      }
      if (score > 0) {
        scored.push({ doc, pageNumber: i + 1, pageText, score });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 6);

  const matches = top.map((item) => {
    let bestStart = 0;
    const lower = item.pageText.toLowerCase();
    for (const tok of uniqueTokens) {
      const idx = lower.indexOf(tok);
      if (idx >= 0) {
        bestStart = Math.max(0, idx - 280);
        break;
      }
    }
    const excerpt = item.pageText.slice(bestStart, bestStart + 1800).trim();
    return {
      docId: item.doc.id,
      title: item.doc.title,
      category: item.doc.category,
      note: item.doc.note,
      pageNumber: item.pageNumber,
      excerpt: excerpt || item.pageText.slice(0, 1500),
    };
  });

  if (matches.length === 0) {
    for (const doc of docs.slice(0, 2)) {
      const pages = pagesByDocId.get(doc.id);
      if (pages && pages[0]) {
        matches.push({
          docId: doc.id,
          title: doc.title,
          category: doc.category,
          note: doc.note,
          pageNumber: 1,
          excerpt: pages[0].slice(0, 1200),
        });
      }
    }
  }

  return { catalogSummary, matches };
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
    const MAX_BODY = 4 * 1024 * 1024; // 4 MB (Vercel serverless max payload is 4.5 MB)

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

function mapErrorStatus(err: unknown): { status: number; error: string } {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg === 'INVALID_CREDENTIALS') {
    return { status: 401, error: 'Login yoki parol noto‘g‘ri.' };
  }
  if (msg === 'ACCOUNT_BLOCKED') {
    return {
      status: 403,
      error: 'Sizning hisobingiz bloklangan. Administrator bilan bog‘laning.',
    };
  }
  if (msg === 'UNAUTHORIZED') {
    return {
      status: 401,
      error: 'Sessiya muddati tugagan yoki tizimga kirish talab etiladi.',
    };
  }
  if (msg === 'FORBIDDEN') {
    return {
      status: 403,
      error: 'Ushbu amal faqat administrator uchun ruxsat etilgan.',
    };
  }
  if (msg.startsWith('DB_ERROR:')) {
    return {
      status: 500,
      error: `Ma’lumotlar bazasi xatoligi: ${msg.slice(9)}`,
    };
  }
  return { status: 400, error: msg || 'So‘rovni bajarishda xatolik yuz berdi.' };
}

export async function executeStoreRequest(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  const cfg = getSupabaseConfig();

  // Status check works even before Supabase env vars are set
  if (req.method === 'GET') {
    if (!cfg) {
      sendJson(res, 200, {
        cloudEnabled: false,
        adminConfigured: true,
        envAdminActive: false,
        documentCount: 0,
      });
      return;
    }

    try {
      await ensurePrimaryAdminSeeded(cfg);
      const docs = await sbFetch<Array<{ id: string }>>(
        cfg,
        'prolex_documents?select=id'
      );
      sendJson(res, 200, {
        cloudEnabled: true,
        adminConfigured: true,
        envAdminActive: true,
        documentCount: docs.length,
      });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      sendJson(res, mapped.status, { error: mapped.error });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'Faqat GET yoki POST so‘rovi qabul qilinadi.' });
    return;
  }

  if (!cfg) {
    sendJson(res, 503, {
      code: 'SUPABASE_NOT_CONFIGURED',
      error:
        'Supabase ma’lumotlar bazasi ulanmagan. Vercel Environment Variables bo‘limiga SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY qo‘shing.',
    });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body.action !== 'string') {
    sendJson(res, 400, { error: 'So‘rov tanasi yoki action ko‘rsatilmagan.' });
    return;
  }

  const action = body.action;
  const { token: extractedToken, fromCookie } = extractSessionToken(req);

  if (fromCookie && !isSameOriginMutationAllowed(req)) {
    sendJson(res, 403, { error: 'So‘rov manbasi (Origin) tasdiqlanmadi.' });
    return;
  }

  try {
    await ensurePrimaryAdminSeeded(cfg);

    if (action === 'login') {
      const loginInput = typeof body.login === 'string' ? body.login.trim() : '';
      const passwordInput = typeof body.password === 'string' ? body.password : '';
      if (!loginInput || !passwordInput) {
        sendJson(res, 400, { error: 'Login va parol kiritilishi shart.' });
        return;
      }

      const rows = await sbFetch<DbUserRow[]>(
        cfg,
        `prolex_users?login_lower=eq.${encodeURIComponent(
          loginInput.toLowerCase()
        )}&select=id,name,login,role,status,password_hash,password_salt,created_at`
      );
      const found = rows[0];
      if (!found) {
        throw new Error('INVALID_CREDENTIALS');
      }
      if (found.status === 'blocked') {
        throw new Error('ACCOUNT_BLOCKED');
      }
      if (!verifyPasswordScrypt(passwordInput, found.password_salt, found.password_hash)) {
        throw new Error('INVALID_CREDENTIALS');
      }

      const sessionToken = `prolex-sb-${crypto.randomBytes(32).toString('base64url')}`;
      const tokenHash = sha256Hex(sessionToken);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await sbFetch(cfg, 'prolex_sessions', {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          token_hash: tokenHash,
          user_id: found.id,
          expires_at: expiresAt,
        },
      });

      setSessionCookie(res, req, sessionToken);
      sendJson(res, 200, { token: sessionToken, user: toPublicUser(found) });
      return;
    }

    if (action === 'restoreSession') {
      if (!extractedToken) {
        sendJson(res, 200, { session: null });
        return;
      }
      try {
        const user = await requireCloudUser(cfg, extractedToken);
        sendJson(res, 200, { session: { token: extractedToken, user } });
      } catch {
        clearSessionCookie(res, req);
        sendJson(res, 200, { session: null });
      }
      return;
    }

    if (action === 'logout') {
      if (extractedToken) {
        const tokenHash = sha256Hex(extractedToken);
        await sbFetch(cfg, `prolex_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
      clearSessionCookie(res, req);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'getMe') {
      const user = await requireCloudUser(cfg, extractedToken);
      sendJson(res, 200, { user });
      return;
    }

    // --- Admin User Management ---
    if (action === 'listUsers') {
      await requireCloudAdmin(cfg, extractedToken);
      const rows = await sbFetch<DbUserRow[]>(
        cfg,
        'prolex_users?select=id,name,login,role,status,created_at&order=created_at.desc'
      );
      sendJson(res, 200, { users: rows.map(toPublicUser) });
      return;
    }

    if (action === 'createUser') {
      await requireCloudAdmin(cfg, extractedToken);
      const cleanName = typeof body.name === 'string' ? body.name.trim() : '';
      const cleanLogin = typeof body.login === 'string' ? body.login.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (cleanName.length < 2) {
        sendJson(res, 400, {
          error: 'Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }
      if (cleanLogin.length < 3 || /\s/.test(cleanLogin)) {
        sendJson(res, 400, {
          error: 'Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.',
        });
        return;
      }
      if (password.length < 6) {
        sendJson(res, 400, {
          error: 'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }

      const existing = await sbFetch<Array<{ id: string }>>(
        cfg,
        `prolex_users?login_lower=eq.${encodeURIComponent(cleanLogin.toLowerCase())}&select=id`
      );
      if (existing.length > 0) {
        sendJson(res, 409, { error: 'Bu login allaqachon ro‘yxatda mavjud.' });
        return;
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPasswordScrypt(password, salt);
      const createdRows = await sbFetch<DbUserRow[]>(cfg, 'prolex_users', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: crypto.randomUUID(),
          name: cleanName.slice(0, 120),
          login: cleanLogin.slice(0, 120),
          role: 'user',
          status: 'active',
          password_hash: passwordHash,
          password_salt: salt,
        },
      });
      sendJson(res, 200, { user: toPublicUser(createdRows[0]) });
      return;
    }

    if (action === 'updateUserStatus') {
      const admin = await requireCloudAdmin(cfg, extractedToken);
      const targetId = typeof body.userId === 'string' ? body.userId : '';
      const status = body.status === 'blocked' ? 'blocked' : body.status === 'active' ? 'active' : null;
      if (!targetId || !status) {
        sendJson(res, 400, { error: 'Foydalanuvchi ID yoki holat noto‘g‘ri.' });
        return;
      }
      if (targetId === admin.id) {
        sendJson(res, 400, { error: 'O‘z administrator hisobingizni bloklay olmaysiz.' });
        return;
      }
      const targets = await sbFetch<DbUserRow[]>(
        cfg,
        `prolex_users?id=eq.${encodeURIComponent(targetId)}&select=id,role`
      );
      const target = targets[0];
      if (!target) {
        sendJson(res, 404, { error: 'Foydalanuvchi topilmadi.' });
        return;
      }
      if (target.role === 'admin') {
        sendJson(res, 400, {
          error: 'Administrator hisobi holatini o‘zgartirish mumkin emas.',
        });
        return;
      }

      const updated = await sbFetch<DbUserRow[]>(
        cfg,
        `prolex_users?id=eq.${encodeURIComponent(targetId)}`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: { status },
        }
      );

      if (status === 'blocked') {
        await sbFetch(cfg, `prolex_sessions?user_id=eq.${encodeURIComponent(targetId)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }

      sendJson(res, 200, { user: toPublicUser(updated[0]) });
      return;
    }

    if (action === 'updateUser') {
      await requireCloudAdmin(cfg, extractedToken);
      const targetId = typeof body.userId === 'string' ? body.userId : '';
      if (!targetId) {
        sendJson(res, 400, { error: 'Foydalanuvchi ID ko‘rsatilmagan.' });
        return;
      }

      const targets = await sbFetch<DbUserRow[]>(
        cfg,
        `prolex_users?id=eq.${encodeURIComponent(targetId)}&select=id,name,login,role,status,password_hash,password_salt,created_at`
      );
      const target = targets[0];
      if (!target) {
        sendJson(res, 404, { error: 'Foydalanuvchi topilmadi.' });
        return;
      }

      const nextName =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 120)
          : target.name;
      if (nextName.length < 2) {
        sendJson(res, 400, {
          error: 'Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }

      const nextLogin =
        typeof body.login === 'string' && body.login.trim()
          ? body.login.trim().slice(0, 120)
          : target.login;
      if (nextLogin.length < 3 || /\s/.test(nextLogin)) {
        sendJson(res, 400, {
          error: 'Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.',
        });
        return;
      }

      if (target.id === PRIMARY_ADMIN_ID && nextLogin.toLowerCase() !== target.login.toLowerCase()) {
        sendJson(res, 400, { error: 'Asosiy administrator loginini o‘zgartirib bo‘lmaydi.' });
        return;
      }

      const duplicates = await sbFetch<Array<{ id: string }>>(
        cfg,
        `prolex_users?login_lower=eq.${encodeURIComponent(
          nextLogin.toLowerCase()
        )}&id=neq.${encodeURIComponent(targetId)}&select=id`
      );
      if (duplicates.length > 0) {
        sendJson(res, 409, {
          error: 'Bu login boshqa foydalanuvchi tomonidan band qilingan.',
        });
        return;
      }

      const patchPayload: Record<string, unknown> = {
        name: nextName,
        login: nextLogin,
      };
      if (typeof body.password === 'string' && body.password.length > 0) {
        if (body.password.length < 6) {
          sendJson(res, 400, {
            error: 'Yangi parol kamida 6 ta belgidan iborat bo‘lishi kerak.',
          });
          return;
        }
        const salt = crypto.randomBytes(16).toString('hex');
        patchPayload.password_salt = salt;
        patchPayload.password_hash = hashPasswordScrypt(body.password, salt);
      }

      const updated = await sbFetch<DbUserRow[]>(
        cfg,
        `prolex_users?id=eq.${encodeURIComponent(targetId)}`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: patchPayload,
        }
      );
      sendJson(res, 200, { user: toPublicUser(updated[0]) });
      return;
    }

    if (action === 'deleteUser') {
      const admin = await requireCloudAdmin(cfg, extractedToken);
      const targetId = typeof body.userId === 'string' ? body.userId : '';
      if (!targetId) {
        sendJson(res, 400, { error: 'Foydalanuvchi ID ko‘rsatilmagan.' });
        return;
      }
      if (targetId === admin.id) {
        sendJson(res, 400, { error: 'O‘z administrator hisobingizni o‘chira olmaysiz.' });
        return;
      }
      const targets = await sbFetch<Array<{ id: string; role: UserRole }>>(
        cfg,
        `prolex_users?id=eq.${encodeURIComponent(targetId)}&select=id,role`
      );
      const target = targets[0];
      if (!target) {
        sendJson(res, 404, { error: 'Foydalanuvchi topilmadi.' });
        return;
      }
      if (target.role === 'admin') {
        sendJson(res, 400, { error: 'Administrator hisobini o‘chirish mumkin emas.' });
        return;
      }

      await sbFetch(cfg, `prolex_users?id=eq.${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'updateAdminPassword') {
      const adminPublic = await requireCloudAdmin(cfg, extractedToken);
      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      const rows = await sbFetch<DbUserRow[]>(
        cfg,
        `prolex_users?id=eq.${encodeURIComponent(adminPublic.id)}&select=id,password_hash,password_salt`
      );
      const adminRow = rows[0];
      if (!adminRow) {
        sendJson(res, 404, { error: 'Administrator topilmadi.' });
        return;
      }
      if (!verifyPasswordScrypt(currentPassword, adminRow.password_salt, adminRow.password_hash)) {
        sendJson(res, 400, { error: 'Joriy parol noto‘g‘ri.' });
        return;
      }
      if (newPassword.length < 8) {
        sendJson(res, 400, {
          error: 'Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPasswordScrypt(newPassword, salt);
      await sbFetch(cfg, `prolex_users?id=eq.${encodeURIComponent(adminPublic.id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { password_salt: salt, password_hash: passwordHash },
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    // --- Chats (Strictly user_id isolated) ---
    if (action === 'listChats') {
      const user = await requireCloudUser(cfg, extractedToken);
      const rows = await sbFetch<DbChatRow[]>(
        cfg,
        `prolex_chats?user_id=eq.${encodeURIComponent(
          user.id
        )}&select=id,user_id,title,message_count,created_at,updated_at,messages&order=updated_at.desc`
      );
      sendJson(res, 200, { chats: rows.map(toChatSummary) });
      return;
    }

    if (action === 'createChat') {
      const user = await requireCloudUser(cfg, extractedToken);
      const title =
        (typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '') ||
        'Yangi huquqiy tahlil';
      const now = new Date().toISOString();
      const createdRows = await sbFetch<DbChatRow[]>(cfg, 'prolex_chats', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: crypto.randomUUID(),
          user_id: user.id,
          title,
          messages: [],
          message_count: 0,
          created_at: now,
          updated_at: now,
        },
      });
      sendJson(res, 200, { chat: toChatSession(createdRows[0]) });
      return;
    }

    if (action === 'getChat') {
      const user = await requireCloudUser(cfg, extractedToken);
      const chatId = typeof body.chatId === 'string' ? body.chatId : '';
      if (!chatId) {
        sendJson(res, 400, { error: 'Suhbat ID ko‘rsatilmagan.' });
        return;
      }
      const rows = await sbFetch<DbChatRow[]>(
        cfg,
        `prolex_chats?id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(
          user.id
        )}&select=id,user_id,title,messages,message_count,created_at,updated_at`
      );
      if (!rows[0]) {
        sendJson(res, 404, { error: 'Suhbat topilmadi yoki sizga tegishli emas.' });
        return;
      }
      sendJson(res, 200, { chat: toChatSession(rows[0]) });
      return;
    }

    if (action === 'deleteChat') {
      const user = await requireCloudUser(cfg, extractedToken);
      const chatId = typeof body.chatId === 'string' ? body.chatId : '';
      if (!chatId) {
        sendJson(res, 400, { error: 'Suhbat ID ko‘rsatilmagan.' });
        return;
      }
      await sbFetch(
        cfg,
        `prolex_chats?id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(
          user.id
        )}`,
        { method: 'DELETE' }
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'appendChatMessages') {
      const user = await requireCloudUser(cfg, extractedToken);
      const chatId = typeof body.chatId === 'string' ? body.chatId : '';
      const newMessages = Array.isArray(body.newMessages)
        ? (body.newMessages as ChatMessage[])
        : [];
      const newTitle =
        typeof body.newTitle === 'string' && body.newTitle.trim()
          ? body.newTitle.trim().slice(0, 80)
          : undefined;

      if (!chatId) {
        sendJson(res, 400, { error: 'Suhbat ID ko‘rsatilmagan.' });
        return;
      }

      const rows = await sbFetch<DbChatRow[]>(
        cfg,
        `prolex_chats?id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(
          user.id
        )}&select=id,user_id,title,messages,message_count,created_at,updated_at`
      );
      const existing = rows[0];
      if (!existing) {
        sendJson(res, 404, { error: 'Suhbat topilmadi yoki o‘chirilgan.' });
        return;
      }

      const mergedMessages = [
        ...(Array.isArray(existing.messages) ? existing.messages : []),
        ...newMessages,
      ];
      const updatedRows = await sbFetch<DbChatRow[]>(
        cfg,
        `prolex_chats?id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(
          user.id
        )}`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: {
            title: newTitle ?? existing.title,
            messages: mergedMessages,
            message_count: mergedMessages.length,
            updated_at: new Date().toISOString(),
          },
        }
      );
      sendJson(res, 200, { chat: toChatSession(updatedRows[0]) });
      return;
    }

    // --- Documents (Admin uploads, all authenticated users read/search) ---
    if (action === 'listDocuments') {
      await requireCloudUser(cfg, extractedToken);
      const rows = await sbFetch<DbDocumentRow[]>(
        cfg,
        'prolex_documents?select=id,title,category,note,original_file_name,size_bytes,page_count,extracted_chars,indexed,uploaded_by,created_at&order=created_at.desc'
      );
      sendJson(res, 200, { documents: rows.map(toDocumentMeta) });
      return;
    }

    if (action === 'searchDocumentExcerpts') {
      await requireCloudUser(cfg, extractedToken);
      const query = typeof body.query === 'string' ? body.query : '';
      const docRows = await sbFetch<DbDocumentRow[]>(
        cfg,
        'prolex_documents?select=id,title,category,note,original_file_name,size_bytes,page_count,extracted_chars,indexed,uploaded_by,created_at&order=created_at.desc'
      );
      const docs = docRows.map(toDocumentMeta);
      if (docs.length === 0) {
        sendJson(res, 200, { catalogSummary: '', matches: [] });
        return;
      }
      const pageRows = await sbFetch<DbDocPagesRow[]>(
        cfg,
        'prolex_doc_pages?select=doc_id,pages'
      );
      const pagesByDocId = new Map<string, string[]>();
      for (const p of pageRows) {
        pagesByDocId.set(p.doc_id, Array.isArray(p.pages) ? p.pages : []);
      }
      sendJson(res, 200, searchExcerptsInPages(query, docs, pagesByDocId));
      return;
    }

    if (action === 'uploadDocumentInit') {
      const admin = await requireCloudAdmin(cfg, extractedToken);
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 180) : '';
      const category = typeof body.category === 'string' ? body.category.trim().slice(0, 80) : '';
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 400) : '';
      const originalFileName =
        typeof body.originalFileName === 'string' ? body.originalFileName.slice(0, 260) : 'document.pdf';
      const sizeBytes = Number(body.sizeBytes) || 0;
      const pageCount = Number(body.pageCount) || 0;
      const extractedChars = Number(body.extractedChars) || 0;
      const initialPages = Array.isArray(body.pages)
        ? body.pages.map((p) => String(p ?? ''))
        : [];

      if (title.length < 2 || !category) {
        sendJson(res, 400, { error: 'Hujjat nomi va sohasi ko‘rsatilishi shart.' });
        return;
      }

      const docId = crypto.randomUUID();
      const createdDocs = await sbFetch<DbDocumentRow[]>(cfg, 'prolex_documents', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: docId,
          title,
          category,
          note,
          original_file_name: originalFileName,
          size_bytes: sizeBytes,
          page_count: pageCount,
          extracted_chars: extractedChars,
          indexed: true,
          uploaded_by: admin.name,
        },
      });

      await sbFetch(cfg, 'prolex_doc_pages', {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          doc_id: docId,
          pages: initialPages,
        },
      });

      sendJson(res, 200, { document: toDocumentMeta(createdDocs[0]) });
      return;
    }

    if (action === 'appendDocumentPages') {
      await requireCloudAdmin(cfg, extractedToken);
      const docId = typeof body.docId === 'string' ? body.docId : '';
      const extraPages = Array.isArray(body.pages)
        ? body.pages.map((p) => String(p ?? ''))
        : [];
      if (!docId || extraPages.length === 0) {
        sendJson(res, 400, { error: 'Hujjat ID yoki sahifalar ko‘rsatilmagan.' });
        return;
      }

      const existing = await sbFetch<DbDocPagesRow[]>(
        cfg,
        `prolex_doc_pages?doc_id=eq.${encodeURIComponent(docId)}&select=doc_id,pages`
      );
      if (!existing[0]) {
        sendJson(res, 404, { error: 'Hujjat sahifalari topilmadi.' });
        return;
      }
      const merged = [
        ...(Array.isArray(existing[0].pages) ? existing[0].pages : []),
        ...extraPages,
      ];
      await sbFetch(cfg, `prolex_doc_pages?doc_id=eq.${encodeURIComponent(docId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { pages: merged },
      });
      sendJson(res, 200, { ok: true, totalPages: merged.length });
      return;
    }

    if (action === 'deleteDocument') {
      await requireCloudAdmin(cfg, extractedToken);
      const docId = typeof body.docId === 'string' ? body.docId : '';
      if (!docId) {
        sendJson(res, 400, { error: 'Hujjat ID ko‘rsatilmagan.' });
        return;
      }
      await sbFetch(cfg, `prolex_documents?id=eq.${encodeURIComponent(docId)}`, {
        method: 'DELETE',
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 400, { error: `Noma’lum amal: ${action}` });
  } catch (err) {
    const mapped = mapErrorStatus(err);
    sendJson(res, mapped.status, { error: mapped.error });
  }
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  await executeStoreRequest(req, res);
}
