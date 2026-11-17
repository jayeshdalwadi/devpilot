import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('GET /health', () => {
  it('reports ok when the database responds', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('reports 503 when the database is down', async () => {
    const { app, prisma } = createTestApp();
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.db).toBe('down');
  });
});

describe('unknown routes', () => {
  it('return 404 JSON', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
