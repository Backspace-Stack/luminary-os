import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { modelService } from '../services/ModelService';
import { defaultModelsDir } from '../models/gguf/ModelsFolder';
import { eventBus, EVENTS } from '../core/events/EventBus';
import { AppError } from '../middleware/errorHandler';

const router = Router();

/**
 * PUT /api/models/upload?name=<file.gguf> — drag-and-drop install.
 * Streams the request body straight into the models/ folder; the
 * folder watcher then detects, scans and registers it live.
 */
router.put('/upload', (req: Request, res: Response, next: NextFunction) => {
  const rawName = String(req.query.name ?? '').trim();
  // Strip any path components — the file lands at the models root
  const fileName = rawName;
  if (!/^[^\\/<>:"|?*\x00-\x1f]+\.gguf$/i.test(fileName) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(fileName)) {
    return next(new AppError('Only .gguf files can be installed here', 400));
  }
  const target = path.join(defaultModelsDir(), fileName);
  if (fs.existsSync(target)) {
    return next(new AppError(`"${fileName}" already exists in the models folder`, 409));
  }

  const tmp = `${target}.${randomUUID()}.uploading`;
  const out = fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
  let failed = false;
  let received = 0;
  let prefix = Buffer.alloc(0);
  const configuredLimit = Number(process.env.MODEL_UPLOAD_MAX_BYTES);
  const maxBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 16 * 1024 ** 3;

  const cleanup = (err: Error, status = 500) => {
    if (failed) return;
    failed = true;
    out.destroy();
    req.unpipe(out);
    out.once('close', () => fs.unlink(tmp, () => { /* best-effort */ }));
    req.resume();
    next(new AppError(`Upload failed: ${err.message}`, status));
  };

  req.on('error', err => cleanup(err));
  req.on('aborted', () => cleanup(new Error('Request aborted.'), 400));
  req.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (prefix.length < 4) prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
    if (received > maxBytes) cleanup(new Error('Model exceeds the configured upload size limit.'), 413);
    else if (prefix.length === 4 && prefix.toString('ascii') !== 'GGUF') cleanup(new Error('Invalid GGUF header.'), 400);
  });
  out.on('error', err => cleanup(err));
  out.on('finish', () => {
    if (failed) return;
    if (prefix.toString('ascii') !== 'GGUF') { cleanup(new Error('Invalid GGUF header.'), 400); return; }
    try {
      // An exclusive link publishes only complete data and cannot replace an
      // existing file, even when two requests race for the same name.
      fs.linkSync(tmp, target);
      fs.unlinkSync(tmp);
      res.json({ success: true, data: { fileName, sizeBytes: fs.statSync(target).size } });
    } catch (err) {
      cleanup(err instanceof Error ? err : new Error(String(err)), (err as NodeJS.ErrnoException).code === 'EEXIST' ? 409 : 500);
    }
  });
  req.pipe(out);
});

/**
 * GET /api/models/events — Server-Sent Events stream.
 * Emits {"type":"models-changed"} whenever the model set changes
 * (GGUF file added/removed via the folder watcher, pull, delete,
 * load, unload), so the UI updates with no manual Refresh.
 */
router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');

  const notify = () => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'models-changed' })}\n\n`);
  };
  const unsubs = [
    eventBus.on(EVENTS.MODELS_CHANGED, notify),
    eventBus.on(EVENTS.MODEL_LOADED, notify),
    eventBus.on(EVENTS.MODEL_UNLOADED, notify),
  ];
  // Keep proxies from timing out the idle stream
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubs.forEach((u) => u());
  });
});

/** GET /api/models — all models across providers (live from Ollama). */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const models = await modelService.listAllModels();
    res.json({ success: true, data: models, total: models.length });
  } catch (err) { next(err); }
});

/** GET /api/models/providers */
router.get('/providers', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: modelService.listProviders() });
  } catch (err) { next(err); }
});

/** GET /api/models/health */
router.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await modelService.healthCheckAll();
    res.json({ success: true, data: health });
  } catch (err) { next(err); }
});

/** GET /api/models/running — models currently loaded in memory. */
router.get('/running', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await modelService.listRunning() });
  } catch (err) { next(err); }
});

/**
 * POST /api/models/pull — download a model, streaming NDJSON progress:
 *   {"type":"progress","status","completed?","total?"}
 *   {"type":"done"} | {"type":"error","message"}
 * Body: { name: string }
 */
router.post('/pull', async (req: Request, res: Response) => {
  const name = String(req.body?.name ?? '').trim();

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const write = (obj: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
  };

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (!name) throw new Error('"name" is required — e.g. "llama3.2:3b"');
    await modelService.pullModel(
      name,
      (progress) => write({ type: 'progress', ...progress }),
      controller.signal,
    );
    write({ type: 'done' });
  } catch (err) {
    if (!controller.signal.aborted) {
      write({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    res.end();
  }
});

/** DELETE /api/models/:id — permanently remove a model (URL-encoded name). */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await modelService.deleteModel(req.params.id, req.query.providerId as string | undefined);
    res.json({ success: true, message: `Model ${req.params.id} deleted` });
  } catch (err) { next(err); }
});

/** POST /api/models/:id/load — load into memory (Ollama keep_alive). */
router.post('/:id/load', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await modelService.loadModel(req.params.id, req.body?.providerId);
    res.json({ success: true, message: `Model ${req.params.id} loaded` });
  } catch (err) { next(err); }
});

/** POST /api/models/:id/unload — evict from memory. */
router.post('/:id/unload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await modelService.unloadModel(req.params.id, req.body?.providerId);
    res.json({ success: true, message: `Model ${req.params.id} unloaded` });
  } catch (err) { next(err); }
});

export default router;
