import { Router, Request, Response, NextFunction } from 'express';
import { memoryService } from '../services/MemoryService';
import type { MemoryQuery } from '../core/types/IMemoryProvider';

const router = Router();

/** GET /api/memory?type=fact&agentId=conversation-agent&importance=high */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query: MemoryQuery = {
      type:       req.query.type       as MemoryQuery['type'],
      agentId:    req.query.agentId    as string,
      importance: req.query.importance as MemoryQuery['importance'],
      limit:      req.query.limit ? Number(req.query.limit) : undefined,
    };
    const data = await memoryService.list(query);
    res.json({ success: true, data, total: data.length });
  } catch (err) { next(err); }
});

/** GET /api/memory/:id */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await memoryService.get(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Memory entry not found' });
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
});

/** POST /api/memory */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await memoryService.create(req.body);
    res.status(201).json({ success: true, data: entry });
  } catch (err) { next(err); }
});

/** PATCH /api/memory/:id */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await memoryService.update(req.params.id, req.body);
    if (!entry) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
});

/** DELETE /api/memory/:id */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await memoryService.remove(req.params.id);
    if (!ok) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
