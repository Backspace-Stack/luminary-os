import { Router, Request, Response, NextFunction } from 'express';
import { systemService } from '../services/SystemService';

const router = Router();

/** GET /api/system/status */
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const snapshot = await systemService.getSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (err) { next(err); }
});

export default router;
