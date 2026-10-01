// ============================================================
// /api/settings — Persisted application settings.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { settingsService, SettingsError } from '../services/SettingsService';
import { ggufFolders } from '../models/providers/LocalProvider';
import { ggufWatcher } from '../models/gguf/GgufWatcher';
import { eventBus, EVENTS } from '../core/events/EventBus';
import { AppError } from '../middleware/errorHandler';

const router = Router();

/** GET /api/settings */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: settingsService.get() });
  } catch (err) { next(err); }
});

/**
 * PUT /api/settings/gguf-folder — set or clear the GGUF models folder.
 * Body: { path: string | null }  (null or '' clears the setting)
 */
router.put('/gguf-folder', (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.body?.path;
    if (raw === undefined || (raw !== null && typeof raw !== 'string')) {
      throw new SettingsError('"path" must be a string or null');
    }
    const settings = settingsService.setGgufFolder(raw);
    // Folder set changed: re-point the live watcher and tell the UI
    ggufWatcher.start(ggufFolders());
    eventBus.emit(EVENTS.MODELS_CHANGED, { source: 'settings' }, 'SettingsRoute');
    res.json({ success: true, data: settings });
  } catch (err) {
    if (err instanceof SettingsError) return next(new AppError(err.message, err.statusCode));
    next(err);
  }
});

export default router;
