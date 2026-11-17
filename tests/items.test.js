import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('/api/items', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('creates and lists items', async () => {
    const created = await request(app).post('/api/items').send({ name: 'First', description: 'hello' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, name: 'First', description: 'hello' });

    const list = await request(app).get('/api/items');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('rejects an item without a name', async () => {
    const res = await request(app).post('/api/items').send({ description: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('trims names and rejects blank ones', async () => {
    const res = await request(app).post('/api/items').send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('gets a single item, or 404', async () => {
    await request(app).post('/api/items').send({ name: 'A' });
    expect((await request(app).get('/api/items/1')).body.name).toBe('A');
    expect((await request(app).get('/api/items/99')).status).toBe(404);
  });

  it('rejects a non-numeric id', async () => {
    const res = await request(app).get('/api/items/abc');
    expect(res.status).toBe(400);
  });

  it('updates an item', async () => {
    await request(app).post('/api/items').send({ name: 'A' });
    const res = await request(app).patch('/api/items/1').send({ name: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('B');
  });

  it('rejects an empty update and 404s a missing item', async () => {
    await request(app).post('/api/items').send({ name: 'A' });
    expect((await request(app).patch('/api/items/1').send({})).status).toBe(400);
    expect((await request(app).patch('/api/items/42').send({ name: 'Z' })).status).toBe(404);
  });

  it('deletes an item', async () => {
    await request(app).post('/api/items').send({ name: 'A' });
    expect((await request(app).delete('/api/items/1')).status).toBe(204);
    expect((await request(app).delete('/api/items/1')).status).toBe(404);
  });
});
