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

interface DbAppUserRow {
  id: string;
  username: string;
  password: string;
  role: string;
  full_name: string;
  status?: string | null;
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

interface DbChatHistoryRow {
  id: string;
  username: string;
  title: string;
  messages: unknown;
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

interface SignedSessionPayload {
  uid: string;
  usr: string;
  role: UserRole;
  exp: number;
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
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32);

function getPrimaryAdminLogin(): string {
  const envVal = process.env.ADMIN_LOGIN?.trim();
  return envVal && envVal.length >= 3 ? envVal : 'Prolex@admin';
}

function getPrimaryAdminPassword(): string {
  const envVal = process.env.ADMIN_PASSWORD;
  return envVal && envVal.length >= 6 ? envVal : '00081187';
}

function getSigningKey(): Buffer {
  const raw =
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (raw && raw.trim() && !raw.trim().startsWith('MY_')) {
    return crypto.createHash('sha256').update(`prolex-session-v2:${raw.trim()}`).digest();
  }
  return EPHEMERAL_FALLBACK_SECRET;
}

function getSupabaseConfig(): { url: string; apiKey: string } | null {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const apiKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (
    !url ||
    !apiKey ||
    url.startsWith('MY_') ||
    apiKey.startsWith('MY_') ||
    (!url.startsWith('https://') && !url.startsWith('http://'))
  ) {
    return null;
  }
  return { url, apiKey };
}

async function sbFetch<T>(
  cfg: { url: string; apiKey: string },
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
      apikey: cfg.apiKey,
      Authorization: `Bearer ${cfg.apiKey}`,
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
      const code =
        parsed && typeof parsed === 'object' && 'code' in parsed
          ? String((parsed as { code: unknown }).code)
          : '';
      const msg =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `Supabase xatoligi (${res.status})`;
      throw new Error(`DB_ERROR:${code}:${msg}`);
    }

    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

function hashPasswordPbkdf2(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
  return `pbkdf2:${salt}:${derived}`;
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPassword(passwordInput: string, storedPassword: string): boolean {
  if (!storedPassword) return false;
  if (storedPassword.startsWith('pbkdf2:')) {
    const parts = storedPassword.split(':');
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const derived = crypto.pbkdf2Sync(passwordInput, salt, 100_000, 32, 'sha256').toString('hex');
    return timingSafeStrEqual(derived, expectedHex);
  }
  return timingSafeStrEqual(passwordInput, storedPassword);
}

function signSessionToken(user: UserPublic): string {
  const payload: SignedSessionPayload = {
    uid: user.id,
    usr: user.login,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningKey())
    .update(encoded)
    .digest('base64url');
  return `prolex-v2.${encoded}.${sig}`;
}

function verifySignedSessionToken(token: string | null): SignedSessionPayload | null {
  if (!token || !token.startsWith('prolex-v2.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningKey())
    .update(encoded)
    .digest('base64url');
  if (!timingSafeStrEqual(sig, expectedSig)) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedSessionPayload;
    if (!decoded?.uid || !decoded?.usr || typeof decoded.exp !== 'number') return null;
    if (decoded.exp <= Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function toPublicUser(row: DbAppUserRow): UserPublic {
  const adminLogin = getPrimaryAdminLogin().trim().toLowerCase();
  const isAdmin =
    row.username.trim().toLowerCase() === adminLogin && row.role === 'admin';
  return {
    id: row.id,
    name: row.full_name || row.username,
    login: row.username,
    role: isAdmin ? 'admin' : 'user',
    status: row.status === 'blocked' ? 'blocked' : 'active',
    createdAt: row.created_at,
  };
}

function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is ChatMessage => Boolean(m && typeof m === 'object'));
}

function toChatSummary(row: DbChatHistoryRow): ChatSessionSummary {
  const messages = normalizeMessages(row.messages);
  return {
    id: row.id,
    title: row.title || 'Yangi huquqiy tahlil',
    createdAt: messages[0]?.createdAt || row.updated_at,
    updatedAt: row.updated_at,
    messageCount: messages.length,
  };
}

function toChatSession(row: DbChatHistoryRow, userId: string): ChatSession {
  const messages = normalizeMessages(row.messages);
  return {
    id: row.id,
    userId,
    title: row.title || 'Yangi huquqiy tahlil',
    createdAt: messages[0]?.createdAt || row.updated_at,
    updatedAt: row.updated_at,
    messageCount: messages.length,
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

function isMissingColumnDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return msg.includes('42703') || msg.includes('pgrst204') || (msg.includes('column') && msg.includes('status'));
}

function isMissingTableDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return (
    msg.includes('42p01') ||
    msg.includes('pgrst205') ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

async function ensurePrimaryAdminSeeded(cfg: { url: string; apiKey: string }): Promise<void> {
  const adminLogin = getPrimaryAdminLogin();
  const adminPass = getPrimaryAdminPassword();

  const rows = await sbFetch<DbAppUserRow[]>(
    cfg,
    `app_users?or=(id.eq.${encodeURIComponent(
      PRIMARY_ADMIN_ID
    )},role.eq.admin,username.ilike.${encodeURIComponent(adminLogin)})&select=*`
  );

  let primaryRow: DbAppUserRow | undefined;
  for (const row of rows) {
    if (row.username.trim().toLowerCase() === adminLogin.trim().toLowerCase()) {
      primaryRow = row;
    } else if (row.id === PRIMARY_ADMIN_ID) {
      await sbFetch(cfg, `app_users?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          username: adminLogin,
          password: hashPasswordPbkdf2(adminPass),
          role: 'admin',
          full_name: 'Bosh Administrator',
        },
      });
      primaryRow = { ...row, username: adminLogin, role: 'admin' };
    } else if (row.role === 'admin') {
      await sbFetch(cfg, `app_users?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { role: 'user' },
      });
    }
  }

  if (!primaryRow) {
    const baseBody = {
      id: PRIMARY_ADMIN_ID,
      username: adminLogin,
      password: hashPasswordPbkdf2(adminPass),
      role: 'admin',
      full_name: 'Bosh Administrator',
    };
    try {
      await sbFetch(cfg, 'app_users', {
        method: 'POST',
        prefer: 'return=minimal',
        body: { ...baseBody, status: 'active' },
      });
    } catch (err) {
      if (isMissingColumnDbError(err)) {
        await sbFetch(cfg, 'app_users', {
          method: 'POST',
          prefer: 'return=minimal',
          body: baseBody,
        });
      } else if (!(err instanceof Error && err.message.includes('23505'))) {
        throw err;
      }
    }
  } else if (primaryRow.role !== 'admin') {
    await sbFetch(cfg, `app_users?id=eq.${encodeURIComponent(primaryRow.id)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { role: 'admin' },
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
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
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
  cfg: { url: string; apiKey: string },
  token: string | null
): Promise<UserPublic> {
  const verified = verifySignedSessionToken(token);
  if (!verified) {
    throw new Error('UNAUTHORIZED');
  }
  const users = await sbFetch<DbAppUserRow[]>(
    cfg,
    `app_users?id=eq.${encodeURIComponent(verified.uid)}&select=*`
  );
  const row = users[0];
  if (!row) {
    throw new Error('UNAUTHORIZED');
  }
  if (row.status === 'blocked') {
    throw new Error('ACCOUNT_BLOCKED');
  }
  return toPublicUser(row);
}

async function requireCloudAdmin(
  cfg: { url: string; apiKey: string },
  token: string | null
): Promise<UserPublic> {
  const user = await requireCloudUser(cfg, token);
  const adminLogin = getPrimaryAdminLogin().trim().toLowerCase();
  if (user.role !== 'admin' || user.login.trim().toLowerCase() !== adminLogin) {
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
    const MAX_BODY = 4 * 1024 * 1024;

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
    const parts = msg.split(':');
    const detail = parts.slice(2).join(':') || msg.slice(9);
    return {
      status: 500,
      error: `Ma’lumotlar bazasi xatoligi: ${detail}`,
    };
  }
  return { status: 400, error: msg || 'So‘rovni bajarishda xatolik yuz berdi.' };
}

export async function executeStoreRequest(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  const cfg = getSupabaseConfig();

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
      let documentCount = 0;
      try {
        const docs = await sbFetch<Array<{ id: string }>>(cfg, 'prolex_documents?select=id');
        documentCount = docs.length;
      } catch (err) {
        if (!isMissingTableDbError(err)) throw err;
      }
      sendJson(res, 200, {
        cloudEnabled: true,
        adminConfigured: true,
        envAdminActive: true,
        documentCount,
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
        'Supabase ulanmagan. Vercel Environment Variables bo‘limiga VITE_SUPABASE_URL va VITE_SUPABASE_ANON_KEY qo‘shing.',
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

      const rows = await sbFetch<DbAppUserRow[]>(
        cfg,
        `app_users?username=ilike.${encodeURIComponent(loginInput)}&select=*`
      );
      const found = rows[0];
      if (!found) {
        throw new Error('INVALID_CREDENTIALS');
      }
      if (found.status === 'blocked') {
        throw new Error('ACCOUNT_BLOCKED');
      }
      if (!verifyPassword(passwordInput, found.password)) {
        throw new Error('INVALID_CREDENTIALS');
      }

      const publicUser = toPublicUser(found);
      const sessionToken = signSessionToken(publicUser);
      setSessionCookie(res, req, sessionToken);
      sendJson(res, 200, { token: sessionToken, user: publicUser });
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
      clearSessionCookie(res, req);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'getMe') {
      const user = await requireCloudUser(cfg, extractedToken);
      sendJson(res, 200, { user });
      return;
    }

    // --- Admin User Management (`app_users`) ---
    if (action === 'listUsers') {
      await requireCloudAdmin(cfg, extractedToken);
      const rows = await sbFetch<DbAppUserRow[]>(
        cfg,
        'app_users?select=*&order=created_at.desc'
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
      if (cleanLogin.toLowerCase() === getPrimaryAdminLogin().toLowerCase()) {
        sendJson(res, 409, { error: 'Bu login bosh administrator uchun band qilingan.' });
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
        `app_users?username=ilike.${encodeURIComponent(cleanLogin)}&select=id`
      );
      if (existing.length > 0) {
        sendJson(res, 409, { error: 'Bu login allaqachon ro‘yxatda mavjud.' });
        return;
      }

      const passwordHash = hashPasswordPbkdf2(password);
      const baseBody = {
        id: crypto.randomUUID(),
        username: cleanLogin.slice(0, 120),
        password: passwordHash,
        role: 'user',
        full_name: cleanName.slice(0, 120),
      };

      let createdRows: DbAppUserRow[];
      try {
        createdRows = await sbFetch<DbAppUserRow[]>(cfg, 'app_users', {
          method: 'POST',
          prefer: 'return=representation',
          body: { ...baseBody, status: 'active' },
        });
      } catch (err) {
        if (isMissingColumnDbError(err)) {
          createdRows = await sbFetch<DbAppUserRow[]>(cfg, 'app_users', {
            method: 'POST',
            prefer: 'return=representation',
            body: baseBody,
          });
        } else {
          throw err;
        }
      }
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
      const targets = await sbFetch<DbAppUserRow[]>(
        cfg,
        `app_users?id=eq.${encodeURIComponent(targetId)}&select=*`
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

      const updated = await sbFetch<DbAppUserRow[]>(
        cfg,
        `app_users?id=eq.${encodeURIComponent(targetId)}`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: { status },
        }
      );
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

      const targets = await sbFetch<DbAppUserRow[]>(
        cfg,
        `app_users?id=eq.${encodeURIComponent(targetId)}&select=*`
      );
      const target = targets[0];
      if (!target) {
        sendJson(res, 404, { error: 'Foydalanuvchi topilmadi.' });
        return;
      }

      const nextName =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 120)
          : target.full_name;
      if (nextName.length < 2) {
        sendJson(res, 400, {
          error: 'Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }

      const nextLogin =
        typeof body.login === 'string' && body.login.trim()
          ? body.login.trim().slice(0, 120)
          : target.username;
      if (nextLogin.length < 3 || /\s/.test(nextLogin)) {
        sendJson(res, 400, {
          error: 'Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.',
        });
        return;
      }

      if (
        target.username.trim().toLowerCase() === getPrimaryAdminLogin().toLowerCase() &&
        nextLogin.toLowerCase() !== target.username.trim().toLowerCase()
      ) {
        sendJson(res, 400, { error: 'Asosiy administrator loginini o‘zgartirib bo‘lmaydi.' });
        return;
      }

      const duplicates = await sbFetch<Array<{ id: string }>>(
        cfg,
        `app_users?username=ilike.${encodeURIComponent(
          nextLogin
        )}&id=neq.${encodeURIComponent(targetId)}&select=id`
      );
      if (duplicates.length > 0) {
        sendJson(res, 409, {
          error: 'Bu login boshqa foydalanuvchi tomonidan band qilingan.',
        });
        return;
      }

      const patchPayload: Record<string, unknown> = {
        full_name: nextName,
        username: nextLogin,
      };
      if (typeof body.password === 'string' && body.password.length > 0) {
        if (body.password.length < 6) {
          sendJson(res, 400, {
            error: 'Yangi parol kamida 6 ta belgidan iborat bo‘lishi kerak.',
          });
          return;
        }
        patchPayload.password = hashPasswordPbkdf2(body.password);
      }

      const updated = await sbFetch<DbAppUserRow[]>(
        cfg,
        `app_users?id=eq.${encodeURIComponent(targetId)}`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: patchPayload,
        }
      );

      if (nextLogin.toLowerCase() !== target.username.trim().toLowerCase()) {
        await sbFetch(
          cfg,
          `chat_history?username=ilike.${encodeURIComponent(target.username)}`,
          {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: { username: nextLogin },
          }
        ).catch(() => {});
      }

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
      const targets = await sbFetch<DbAppUserRow[]>(
        cfg,
        `app_users?id=eq.${encodeURIComponent(targetId)}&select=*`
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

      await sbFetch(cfg, `app_users?id=eq.${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      await sbFetch(
        cfg,
        `chat_history?username=ilike.${encodeURIComponent(target.username)}`,
        { method: 'DELETE' }
      ).catch(() => {});
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'updateAdminPassword') {
      const adminPublic = await requireCloudAdmin(cfg, extractedToken);
      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      const rows = await sbFetch<DbAppUserRow[]>(
        cfg,
        `app_users?id=eq.${encodeURIComponent(adminPublic.id)}&select=*`
      );
      const adminRow = rows[0];
      if (!adminRow) {
        sendJson(res, 404, { error: 'Administrator topilmadi.' });
        return;
      }
      if (!verifyPassword(currentPassword, adminRow.password)) {
        sendJson(res, 400, { error: 'Joriy parol noto‘g‘ri.' });
        return;
      }
      if (newPassword.length < 8) {
        sendJson(res, 400, {
          error: 'Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }

      await sbFetch(cfg, `app_users?id=eq.${encodeURIComponent(adminPublic.id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { password: hashPasswordPbkdf2(newPassword) },
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    // --- Chats (`chat_history`, strictly isolated by `username`) ---
    if (action === 'listChats') {
      const user = await requireCloudUser(cfg, extractedToken);
      const rows = await sbFetch<DbChatHistoryRow[]>(
        cfg,
        `chat_history?username=ilike.${encodeURIComponent(
          user.login
        )}&select=id,username,title,messages,updated_at&order=updated_at.desc`
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
      const createdRows = await sbFetch<DbChatHistoryRow[]>(cfg, 'chat_history', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: crypto.randomUUID(),
          username: user.login,
          title,
          messages: [],
          updated_at: now,
        },
      });
      sendJson(res, 200, { chat: toChatSession(createdRows[0], user.id) });
      return;
    }

    if (action === 'getChat') {
      const user = await requireCloudUser(cfg, extractedToken);
      const chatId = typeof body.chatId === 'string' ? body.chatId : '';
      if (!chatId) {
        sendJson(res, 400, { error: 'Suhbat ID ko‘rsatilmagan.' });
        return;
      }
      const rows = await sbFetch<DbChatHistoryRow[]>(
        cfg,
        `chat_history?id=eq.${encodeURIComponent(chatId)}&username=ilike.${encodeURIComponent(
          user.login
        )}&select=id,username,title,messages,updated_at`
      );
      if (!rows[0]) {
        sendJson(res, 404, { error: 'Suhbat topilmadi yoki sizga tegishli emas.' });
        return;
      }
      sendJson(res, 200, { chat: toChatSession(rows[0], user.id) });
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
        `chat_history?id=eq.${encodeURIComponent(chatId)}&username=ilike.${encodeURIComponent(
          user.login
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

      const rows = await sbFetch<DbChatHistoryRow[]>(
        cfg,
        `chat_history?id=eq.${encodeURIComponent(chatId)}&username=ilike.${encodeURIComponent(
          user.login
        )}&select=id,username,title,messages,updated_at`
      );
      const existing = rows[0];
      if (!existing) {
        sendJson(res, 404, { error: 'Suhbat topilmadi yoki o‘chirilgan.' });
        return;
      }

      const mergedMessages = [
        ...normalizeMessages(existing.messages),
        ...newMessages,
      ];
      const updatedRows = await sbFetch<DbChatHistoryRow[]>(
        cfg,
        `chat_history?id=eq.${encodeURIComponent(chatId)}&username=ilike.${encodeURIComponent(
          user.login
        )}`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: {
            title: newTitle ?? existing.title,
            messages: mergedMessages,
            updated_at: new Date().toISOString(),
          },
        }
      );
      sendJson(res, 200, { chat: toChatSession(updatedRows[0], user.id) });
      return;
    }

    // --- Optional PDF Knowledge Base (`prolex_documents`, `prolex_doc_pages`) ---
    if (action === 'listDocuments') {
      await requireCloudUser(cfg, extractedToken);
      try {
        const rows = await sbFetch<DbDocumentRow[]>(
          cfg,
          'prolex_documents?select=*&order=created_at.desc'
        );
        sendJson(res, 200, { documents: rows.map(toDocumentMeta) });
      } catch (err) {
        if (isMissingTableDbError(err)) {
          sendJson(res, 200, { documents: [] });
          return;
        }
        throw err;
      }
      return;
    }

    if (action === 'searchDocumentExcerpts') {
      await requireCloudUser(cfg, extractedToken);
      const query = typeof body.query === 'string' ? body.query : '';
      try {
        const docRows = await sbFetch<DbDocumentRow[]>(
          cfg,
          'prolex_documents?select=*&order=created_at.desc'
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
      } catch (err) {
        if (isMissingTableDbError(err)) {
          sendJson(res, 200, { catalogSummary: '', matches: [] });
          return;
        }
        throw err;
      }
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
