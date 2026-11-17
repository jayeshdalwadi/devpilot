import { Router } from 'express';
import { z } from 'zod';

const idParam = z.coerce.number().int().positive();

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const updateSchema = createSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'At least one field is required',
});

export function itemsRouter(prisma) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const items = await prisma.item.findMany({ orderBy: { id: 'asc' } });
    res.json(items);
  });

  router.get('/:id', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  });

  router.post('/', async (req, res) => {
    const data = createSchema.parse(req.body);
    const item = await prisma.item.create({ data });
    res.status(201).json(item);
  });

  router.patch('/:id', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const data = updateSchema.parse(req.body);
    const item = await prisma.item.update({ where: { id }, data });
    res.json(item);
  });

  router.delete('/:id', async (req, res) => {
    const id = idParam.parse(req.params.id);
    await prisma.item.delete({ where: { id } });
    res.status(204).end();
  });

  return router;
}
