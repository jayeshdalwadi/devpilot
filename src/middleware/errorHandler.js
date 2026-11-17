import { ZodError } from 'zod';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.issues });
  }
  // Prisma "record not found"
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Not found' });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal server error' });
}
