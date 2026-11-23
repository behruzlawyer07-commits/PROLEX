import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { executeChatRequest } from './api/chat';
import { executeStoreRequest } from './api/store';

const PORT = Number(process.env.PORT) || 3000;

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  app.all('/api/store', async (req: Request, res: Response) => {
    await executeStoreRequest(req, res);
  });

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

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API manzili topilmadi.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      console.error('[PROLEX API Error]:', err);
      if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : 'Noma’lum xatolik';
        res.status(500).json({ error: `Server ichki xatoligi: ${msg}` });
      }
      return;
    }
    next(err);
  });

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
  });
  server.requestTimeout = 90_000;
}

startServer().catch((err) => {
  console.error('Failed to start PROLEX server:', err);
  process.exit(1);
});
