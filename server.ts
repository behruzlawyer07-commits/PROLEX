import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { executeChatRequest } from './api/chat.ts';
import { prewarmCoreCodes } from './server/lexuzService.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Vercel-compatible serverless route mounted identically in local/AI Studio preview
  app.post('/api/chat', async (req: Request, res: Response) => {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : null;
    const result = await executeChatRequest(body);
    res.status(result.status).json(result.payload);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'PROLEX' });
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
