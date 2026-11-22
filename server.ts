import 'dotenv/config';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { generateLegalAnalysis } from './server/geminiService.ts';
import { prewarmCoreCodes } from './server/lexuzService.ts';
import {
  deletePdfFiles,
  extractAndIndexPdf,
  verifyPdfMagicBytes,
} from './server/pdfService.ts';
import {
  DATA_DIR,
  UPLOADS_DIR,
  addStoredDocument,
  appendChatMessages,
  authenticateUser,
  bootstrapAdmin,
  createUserAccount,
  createUserChat,
  deleteStoredDocument,
  deleteUserAccount,
  deleteUserChat,
  getEnvAdminConfig,
  getStoredDocument,
  getUserById,
  getUserChat,
  isAdminConfigured,
  listStoredDocuments,
  listUserChats,
  listUsers,
  toPublicDocument,
  updateUserStatus,
} from './server/store.ts';
import type { ChatMessage, UserPublic } from './src/types/sherlex.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const secretPath = path.join(DATA_DIR, '.session-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const saved = fs.readFileSync(secretPath, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
  } catch {
    // regenerate below
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignore
  }
  return generated;
}

const SESSION_SECRET = resolveSessionSecret();

interface AuthenticatedRequest extends Request {
  user?: UserPublic;
}

interface TokenPayload {
  sub: string;
  role: 'admin' | 'user';
  exp: number;
}

function signToken(user: UserPublic): string {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as TokenPayload;
    if (!parsed.sub || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Tizimga kirish talab etiladi.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sessiya muddati tugagan yoki yaroqsiz.' });
    return;
  }

  const user = getUserById(payload.sub);
  if (!user) {
    res.status(401).json({ error: 'Foydalanuvchi topilmadi.' });
    return;
  }
  if (user.status === 'blocked') {
    res.status(403).json({ error: 'Sizning hisobingiz administrator tomonidan bloklangan.' });
    return;
  }

  req.user = user;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Ushbu amal faqat administrator uchun ruxsat etilgan.' });
      return;
    }
    next();
  });
}

// Configure Multer for 50 MB PDF Uploads
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, _file, cb) => {
    cb(null, `${crypto.randomUUID()}.pdf`);
  },
});

const uploadPdf = multer({
  storage,
  limits: {
    fileSize: MAX_PDF_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const extOk = file.originalname.toLowerCase().endsWith('.pdf');
    const mimeOk =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/x-pdf' ||
      file.mimetype === 'application/octet-stream';
    if (!extOk || !mimeOk) {
      cb(new Error('INVALID_PDF_TYPE'));
      return;
    }
    cb(null, true);
  },
});

function buildChatTitleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 54) return cleaned;
  return `${cleaned.slice(0, 51).trim()}...`;
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Health & Auth Status (no secrets exposed)
  app.get('/api/auth/status', (_req, res) => {
    res.json({
      adminConfigured: isAdminConfigured(),
      envAdminActive: Boolean(getEnvAdminConfig()),
      documentCount: listStoredDocuments().length,
    });
  });

  // One-time first-run Admin claim when ADMIN_PASSCODE env is not set and no admin exists
  app.post('/api/auth/bootstrap-admin', async (req, res) => {
    try {
      const { name, login, password } = req.body ?? {};
      if (typeof name !== 'string' || typeof login !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Barcha maydonlar to‘ldirilishi shart.' });
        return;
      }
      if (name.trim().length < 2 || login.trim().length < 3 || password.length < 8) {
        res.status(400).json({
          error: 'Ism (kamida 2 belgi), login (kamida 3 belgi) va parol (kamida 8 belgi) kiriting.',
        });
        return;
      }
      const admin = await bootstrapAdmin(name, login, password);
      const token = signToken(admin);
      res.status(201).json({ token, user: admin });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'ADMIN_ALREADY_CONFIGURED') {
        res.status(409).json({ error: 'Administrator hisobi allaqachon o‘rnatilgan.' });
        return;
      }
      if (msg === 'LOGIN_EXISTS') {
        res.status(409).json({ error: 'Ushbu login band.' });
        return;
      }
      res.status(500).json({ error: 'Administratorni sozlashda xatolik yuz berdi.' });
    }
  });

  // Strict Login (No self-registration)
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { login, password } = req.body ?? {};
      if (typeof login !== 'string' || typeof password !== 'string' || !login.trim() || !password) {
        res.status(400).json({ error: 'Login va parolni kiriting.' });
        return;
      }

      const result = await authenticateUser(login, password);
      if ('error' in result) {
        if (result.error === 'ACCOUNT_BLOCKED') {
          res.status(403).json({
            error: 'Sizning hisobingiz bloklangan. Administrator bilan bog‘laning.',
          });
          return;
        }
        res.status(401).json({ error: 'Login yoki parol noto‘g‘ri.' });
        return;
      }

      const token = signToken(result.user);
      res.json({ token, user: result.user });
    } catch {
      res.status(500).json({ error: 'Kirish jarayonida tizim xatoligi yuz berdi.' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // Authenticated Knowledge Summary (read-only metadata for user transparency)
  app.get('/api/knowledge/summary', requireAuth, (_req, res) => {
    const docs = listStoredDocuments().map(toPublicDocument);
    res.json({ count: docs.length, documents: docs });
  });

  // Private User-Isolated Chats
  app.get('/api/chats', requireAuth, (req: AuthenticatedRequest, res) => {
    const chats = listUserChats(req.user!.id);
    res.json({ chats });
  });

  app.post('/api/chats', requireAuth, async (req: AuthenticatedRequest, res) => {
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 80)
        : 'Yangi huquqiy tahlil';
    const chat = await createUserChat(req.user!.id, title);
    res.status(201).json({ chat });
  });

  app.get('/api/chats/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const chat = getUserChat(req.user!.id, String(req.params.id));
    if (!chat) {
      res.status(404).json({ error: 'Suhbat topilmadi yoki sizga tegishli emas.' });
      return;
    }
    res.json({ chat });
  });

  app.delete('/api/chats/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const deleted = await deleteUserChat(req.user!.id, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Suhbat topilmadi.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/chats/:id/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
    const chatId = String(req.params.id);
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    if (!content) {
      res.status(400).json({ error: 'Savol yoki kazus matnini kiriting.' });
      return;
    }
    if (content.length > 15000) {
      res.status(400).json({ error: 'Matn hajmi 15 000 belgidan oshmasligi kerak.' });
      return;
    }

    const chat = getUserChat(req.user!.id, chatId);
    if (!chat) {
      res.status(404).json({ error: 'Suhbat topilmadi.' });
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    try {
      const analysis = await generateLegalAnalysis({
        history: chat.messages,
        userPrompt: content,
      });

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: analysis.text,
        createdAt: new Date().toISOString(),
        sources: analysis.sources,
        referencedPdfs: analysis.referencedPdfs,
      };

      const isFirstTurn = chat.messages.length === 0;
      const updatedTitle = isFirstTurn ? buildChatTitleFromPrompt(content) : undefined;
      const updatedChat = await appendChatMessages(
        req.user!.id,
        chatId,
        [userMessage, assistantMessage],
        updatedTitle
      );

      if (!updatedChat) {
        res.status(404).json({ error: 'Suhbat topilmadi yoki o‘chirilgan.' });
        return;
      }

      res.json({ chat: updatedChat, userMessage, assistantMessage });
    } catch (err) {
      console.error('[PROLEX Gemini Error]:', err);
      const errMsg = err instanceof Error ? err.message : '';
      if (errMsg === 'MISSING_GEMINI_API_KEY') {
        res.status(503).json({
          error:
            'Gemini API kaliti sozlanmagan. Iltimos, Settings > Secrets bo‘limida GEMINI_API_KEY qiymatini tekshiring.',
        });
        return;
      }
      if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('PERMISSION_DENIED')) {
        res.status(502).json({
          error:
            'Gemini API kaliti yaroqsiz yoki ruxsat etilmagan. Settings > Secrets bo‘limidan kalitni tekshiring.',
        });
        return;
      }
      if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
        res.status(429).json({
          error:
            'Gemini API so‘rovlar kvotasi tugadi (429 RESOURCE_EXHAUSTED). Birozdan so‘ng qayta urinib ko‘ring yoki Settings > Secrets bo‘limida to‘lovli (billing-enabled) API kalitini ulang.',
        });
        return;
      }
      if (
        errMsg.includes('503') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.toLowerCase().includes('high demand')
      ) {
        res.status(503).json({
          error:
            'AI xizmatida vaqtincha yuqori yuklama kuzatilmoqda (503). Iltimos, bir necha soniyadan so‘ng qayta yuborib ko‘ring.',
        });
        return;
      }
      if (errMsg === 'EMPTY_MODEL_RESPONSE') {
        res.status(502).json({
          error:
            'AI modelidan bo‘sh javob qaytdi. Iltimos, kazus yoki savolni aniqroq yozib qayta urinib ko‘ring.',
        });
        return;
      }
      if (errMsg.startsWith('TIMEOUT_')) {
        res.status(504).json({
          error:
            'So‘rovni qayta ishlash vaqti tugadi. Iltimos, savolni qayta yuborib ko‘ring.',
        });
        return;
      }
      res.status(502).json({
        error: 'Huquqiy tahlilni shakllantirishda AI xizmatida xatolik yuz berdi. Qayta urinib ko‘ring.',
      });
    }
  });

  // Admin: User Management
  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    res.json({ users: listUsers() });
  });

  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    try {
      const { name, login, password } = req.body ?? {};
      if (typeof name !== 'string' || typeof login !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Ism/lavozim, login va parol kiritilishi shart.' });
        return;
      }
      if (name.trim().length < 2) {
        res.status(400).json({ error: 'Ism va lavozim kamida 2 ta belgidan iborat bo‘lishi kerak.' });
        return;
      }
      if (login.trim().length < 3 || /\s/.test(login.trim())) {
        res.status(400).json({ error: 'Login kamida 3 ta belgidan iborat bo‘lishi va bo‘sh joy saqlamasligi kerak.' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: 'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.' });
        return;
      }

      const created = await createUserAccount({
        name,
        login,
        password,
        role: 'user',
      });
      res.status(201).json({ user: created });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'LOGIN_EXISTS') {
        res.status(409).json({ error: 'Bu login allaqachon ro‘yxatda mavjud.' });
        return;
      }
      res.status(500).json({ error: 'Foydalanuvchi yaratishda xatolik yuz berdi.' });
    }
  });

  app.patch('/api/admin/users/:id/status', requireAdmin, async (req: AuthenticatedRequest, res) => {
    const targetId = String(req.params.id);
    const status = req.body?.status;
    if (status !== 'active' && status !== 'blocked') {
      res.status(400).json({ error: 'Noto‘g‘ri holat qiymati.' });
      return;
    }
    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'O‘z administrator hisobingizni bloklay olmaysiz.' });
      return;
    }
    const target = getUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
      return;
    }
    if (target.role === 'admin') {
      res.status(400).json({ error: 'Administrator hisobi holatini o‘zgartirish mumkin emas.' });
      return;
    }

    const updated = await updateUserStatus(targetId, status);
    res.json({ user: updated });
  });

  app.delete('/api/admin/users/:id', requireAdmin, async (req: AuthenticatedRequest, res) => {
    const targetId = String(req.params.id);
    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'O‘z administrator hisobingizni o‘chira olmaysiz.' });
      return;
    }
    const target = getUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
      return;
    }
    if (target.role === 'admin') {
      res.status(400).json({ error: 'Administrator hisobini o‘chirish mumkin emas.' });
      return;
    }

    await deleteUserAccount(targetId);
    res.json({ ok: true });
  });

  // Admin: PDF Legal Documents Management (50 MB max)
  app.get('/api/admin/documents', requireAdmin, (_req, res) => {
    const docs = listStoredDocuments().map(toPublicDocument);
    res.json({ documents: docs });
  });

  app.post(
    '/api/admin/documents',
    requireAdmin,
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      uploadPdf.single('file')(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({
              error: 'Fayl hajmi belgilangan maksimal 50 MB chegaradan oshib ketdi.',
            });
            return;
          }
          res.status(400).json({ error: `Fayl yuklashda xatolik: ${err.message}` });
          return;
        }
        if (err instanceof Error) {
          if (err.message === 'INVALID_PDF_TYPE') {
            res.status(400).json({
              error: 'Faqat PDF (.pdf) formatidagi hujjatlar qabul qilinadi.',
            });
            return;
          }
          res.status(400).json({ error: err.message });
          return;
        }
        next();
      });
    },
    async (req: AuthenticatedRequest, res: Response) => {
      const uploadedFile = req.file;
      if (!uploadedFile) {
        res.status(400).json({ error: 'PDF fayl tanlanmagan.' });
        return;
      }

      const cleanupUploadedFile = async () => {
        try {
          if (fs.existsSync(uploadedFile.path)) {
            await fs.promises.unlink(uploadedFile.path);
          }
        } catch {
          // ignore
        }
      };

      try {
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
        const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

        if (!title || title.length < 2) {
          await cleanupUploadedFile();
          res.status(400).json({ error: 'Hujjat nomi kiritilishi shart.' });
          return;
        }
        if (!category) {
          await cleanupUploadedFile();
          res.status(400).json({ error: 'Soha / turi tanlanishi shart.' });
          return;
        }

        const isValidPdf = await verifyPdfMagicBytes(uploadedFile.path);
        if (!isValidPdf) {
          await cleanupUploadedFile();
          res.status(400).json({
            error: 'Tanlangan fayl haqiqiy PDF tuzilishiga ega emas. Iltimos, yaroqli PDF yuklang.',
          });
          return;
        }

        const docId = crypto.randomUUID();
        const indexMeta = await extractAndIndexPdf(docId, uploadedFile.path);

        const saved = await addStoredDocument({
          id: docId,
          title: title.slice(0, 180),
          category: category.slice(0, 80),
          note: note.slice(0, 400),
          originalFileName: uploadedFile.originalname,
          storedFileName: uploadedFile.filename,
          sizeBytes: uploadedFile.size,
          pageCount: indexMeta.pageCount,
          extractedChars: indexMeta.extractedChars,
          indexed: indexMeta.indexed,
          createdAt: new Date().toISOString(),
          uploadedBy: req.user!.name,
        });

        res.status(201).json({ document: saved });
      } catch (err) {
        await cleanupUploadedFile();
        console.error('[PDF Upload Error]:', err);
        res.status(500).json({ error: 'PDF hujjatni saqlash va indekslashda xatolik yuz berdi.' });
      }
    }
  );

  app.delete('/api/admin/documents/:id', requireAdmin, async (req, res) => {
    const docId = String(req.params.id);
    const existing = getStoredDocument(docId);
    if (!existing) {
      res.status(404).json({ error: 'Huquqiy manba topilmadi.' });
      return;
    }
    const removed = await deleteStoredDocument(docId);
    if (removed) {
      await deletePdfFiles(removed);
    }
    res.json({ ok: true });
  });

  // Guarantee /api/* requests always return JSON even on unmatched routes or unexpected errors
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API manzili topilmadi.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      console.error('[PROLEX API Error]:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Server ichki xatoligi yuz berdi.' });
      }
      return;
    }
    next(err);
  });

  // Vite / Static Frontend Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`PROLEX server running on http://0.0.0.0:${PORT}`);
    void prewarmCoreCodes().catch((err) => {
      console.warn('[Lex.uz Prewarm] Ogohlantirish:', err);
    });
  });
  server.requestTimeout = 90_000;
}

startServer().catch((err) => {
  console.error('Failed to start PROLEX server:', err);
  process.exit(1);
});
