import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('Items UI', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('serves the list page with a read-only table and a hidden edit modal', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('id="items-table"');
    expect(res.text).toContain('id="add-item"');
    expect(res.text).toContain('Add item');
    expect(res.text).toMatch(/<dialog id="item-modal"(?![^>]*\bopen\b)[^>]*>/);

    // The list itself has no form controls; inputs live only inside the modal.
    const beforeModal = res.text.split('<dialog')[0];
    expect(beforeModal).not.toMatch(/<(input|textarea|select)\b/);
  });

  it('loads scripts and styles from external files (no inline script)', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('src="/app.js"');
    expect(res.text).toContain('href="/styles.css"');
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });

  it('serves the client script and stylesheet', async () => {
    const js = await request(app).get('/app.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.text).toContain('/api/items');
    expect(js.text).not.toContain('innerHTML');

    const css = await request(app).get('/styles.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
  });

  it('keeps the Helmet content security policy on the page', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('still returns JSON 404 for unknown paths', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('does not shadow the API routes', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
