import { vi } from 'vitest';
import { createApp } from '../src/app.js';

/** In-memory stand-in for the Prisma client, enough for the routes under test. */
export function createFakePrisma() {
  let rows = [];
  let nextId = 1;
  const notFound = () => Object.assign(new Error('Record not found'), { code: 'P2025' });

  return {
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
    item: {
      findMany: vi.fn(async () => [...rows]),
      findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
      create: vi.fn(async ({ data }) => {
        const now = new Date();
        const row = { id: nextId++, description: null, ...data, createdAt: now, updatedAt: now };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw notFound();
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      delete: vi.fn(async ({ where }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw notFound();
        rows = rows.filter((r) => r !== row);
        return row;
      }),
    },
  };
}

export function createTestApp() {
  const prisma = createFakePrisma();
  return { app: createApp({ prisma }), prisma };
}
