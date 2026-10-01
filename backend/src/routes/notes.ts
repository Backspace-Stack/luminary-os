// ============================================================
// /api/notes — The user's notes: real CRUD plus "Ask Lumen".
//
//   GET    /api/notes           — every note, most recently updated first
//   POST   /api/notes           — create { title?, content? }
//   GET    /api/notes/:id       — one note
//   PATCH  /api/notes/:id       — update { title?, content? }
//   DELETE /api/notes/:id       — delete
//   POST   /api/notes/:id/ask   — Ask Lumen about a highlighted passage
//
// NotesError carries its own statusCode, so next(err) reaches the shared
// errorHandler with an honest status and message (404 unknown note, 409
// stale passage, 503 storage not up yet).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { notesService } from '../services/NotesService';
import { noteAskService } from '../services/NoteAskService';

const router = Router();

/** GET /api/notes */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = notesService.list();
    res.json({ success: true, data, total: data.length });
  } catch (err) { next(err); }
});

/** POST /api/notes — body { title?, content? } */
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content } = req.body ?? {};
    const note = notesService.create(
      typeof title === 'string' ? title : undefined,
      typeof content === 'string' ? content : undefined,
    );
    res.status(201).json({ success: true, data: note });
  } catch (err) { next(err); }
});

/** GET /api/notes/:id */
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: notesService.get(req.params.id) });
  } catch (err) { next(err); }
});

/** PATCH /api/notes/:id — body { title?, content? } */
router.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content } = req.body ?? {};
    const note = notesService.update(req.params.id, {
      ...(typeof title === 'string' ? { title } : {}),
      ...(typeof content === 'string' ? { content } : {}),
    });
    res.json({ success: true, data: note });
  } catch (err) { next(err); }
});

/** DELETE /api/notes/:id */
router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    notesService.remove(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/**
 * POST /api/notes/:id/ask — body { selection, question? }
 *
 * Runs the Research Agent (always Deep Research, real web search
 * available) on the highlighted passage and splices the real answer
 * into the note beneath it. A research turn can legitimately take
 * minutes, so the socket timeout is lifted for this route only; the
 * agent's own wall-clock budget still bounds the work.
 */
router.post('/:id/ask', async (req: Request, res: Response, next: NextFunction) => {
  req.setTimeout(0);
  res.setTimeout(0);

  // A client that gives up mid-research should stop the work too.
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  try {
    const { selection, question } = req.body ?? {};
    const result = await noteAskService.ask(
      req.params.id,
      typeof selection === 'string' ? selection : '',
      typeof question === 'string' ? question : undefined,
      controller.signal,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    // The client that aborted is gone: next(err) would try to write a JSON
    // body to a closed socket. Nothing left to report to.
    if (controller.signal.aborted || res.writableEnded || res.destroyed) return;
    next(err);
  }
});

export default router;
