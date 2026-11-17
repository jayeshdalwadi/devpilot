import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { healthRouter } from './routes/health.js';
import { itemsRouter } from './routes/items.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/**
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient} deps.prisma
 * @param {import('express').RequestHandler} [deps.webhookMiddleware] GitHub webhook handler (needs the raw body)
 */
export function createApp({ prisma, webhookMiddleware } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());

  // Mounted before express.json() so signature verification sees the raw body.
  if (webhookMiddleware) app.use(webhookMiddleware);

  app.use(express.json({ limit: '1mb' }));

  // Static UI (public/index.html is served at /).
  app.use(express.static(PUBLIC_DIR));

  app.get('/api', (_req, res) => {
    res.json({
      name: 'baseApp',
      endpoints: {
        health: 'GET /health',
        listItems: 'GET /api/items',
        getItem: 'GET /api/items/:id',
        createItem: 'POST /api/items',
        updateItem: 'PATCH /api/items/:id',
        deleteItem: 'DELETE /api/items/:id',
      },
    });
  });

  app.use('/health', healthRouter(prisma));
  app.use('/api/items', itemsRouter(prisma));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
