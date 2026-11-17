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

describe('UI and API index', () => {
  it('serves the UI at /', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<script type="module" src="/app.js">');
  });

  it('serves the UI assets', async () => {
    const { app } = createTestApp();
    expect((await request(app).get('/app.js')).status).toBe(200);
    expect((await request(app).get('/styles.css')).status).toBe(200);
  });

  it('lists the API endpoints at /api', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(res.body.endpoints.health).toBe('GET /health');
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
