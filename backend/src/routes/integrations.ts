// ============================================================
// /api/integrations — API keys for third-party integrations.
//
// GET    /api/integrations        → status of every integration
//                                    (booleans only, never a key value)
// PUT    /api/integrations/:id     → save a key { value } (empty clears)
// DELETE /api/integrations/:id     → remove a saved key
//
// SECURITY: a key value is never returned to the client and never
// logged. Only configured/source status is exposed. Saving takes effect
// immediately — no restart.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { secretsService, SecretsError } from '../services/SecretsService';
import { AppError } from '../middleware/errorHandler';

const router = Router();

/** GET /api/integrations — status list, no values. */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: secretsService.status() });
  } catch (err) { next(err); }
});

/**
 * PUT /api/integrations/:id — set (or clear, with an empty value) a key.
 * Body: { value: string }
 */
router.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const value = req.body?.value;
    if (typeof value !== 'string') {
      throw new SecretsError('"value" must be a string.');
    }
    // The value is used only to store the key — deliberately never logged.
    const status = secretsService.set(req.params.id, value);
    res.json({ success: true, data: status });
  } catch (err) {
    if (err instanceof SecretsError) return next(new AppError(err.message, err.statusCode));
    next(err);
  }
});

/** DELETE /api/integrations/:id — remove a saved key. */
router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = secretsService.remove(req.params.id);
    res.json({ success: true, data: status });
  } catch (err) {
    if (err instanceof SecretsError) return next(new AppError(err.message, err.statusCode));
    next(err);
  }
});

export default router;
