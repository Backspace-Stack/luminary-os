// ============================================================
// /api/chat — Real chat endpoints backed by ChatService.
//
// POST /generate streams NDJSON events:
//   {"type":"meta",  "agentId","agentName","model","messageId"}
//   {"type":"token", "token":"…"}          (many)
//   {"type":"thinking_delta", "text":"…"}  (many; reasoning-model chain-of-thought, tool modes, never persisted)
//   {"type":"tool_call_started",  "plugin","action","args"}       (tool modes)
//   {"type":"tool_call_result",   "plugin","action","success","summary"}
//   {"type":"pending_confirmation","id","plugin","action","args"} (one per gated call)
//   {"type":"pending", "pendingConfirmations":[…]}   (aggregate; turn halted)
//   {"type":"done",  "message":{…}}        (final persisted message)
//   {"type":"error", "message":"…"}        (honest failure)
// All three modes run through BaseAgent.execute() — one loop, streamed.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { chatService, type GenerateMode } from '../services/ChatService';
import { analyticsService, type AnalyticsRange } from '../services/AnalyticsService';
import { denyPendingConfirmations } from '../agents/BaseAgent';

const router = Router();

/** Revoke approval tokens rather than merely hiding the UI prompt. */
router.post('/conversations/:id/deny', (req: Request, res: Response, next: NextFunction) => {
  try {
    chatService.get(req.params.id);
    const ids: unknown = req.body?.confirmationIds;
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
      res.status(400).json({success:false,message:'confirmationIds must be an array of strings.'}); return;
    }
    denyPendingConfirmations(req.params.id, ids);
    res.json({success:true,data:{denied:true}});
  } catch (err) { next(err); }
});

/**
 * GET /api/chat/analytics?range=all|30d|7d&agent=<id> — real usage analytics.
 * Optional `agent` scopes the whole report to one agent (e.g. coding-agent).
 */
router.get('/analytics', (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = String(req.query.range ?? 'all');
    const range: AnalyticsRange = raw === '7d' || raw === '30d' ? raw : 'all';
    const agent = typeof req.query.agent === 'string' && req.query.agent.trim() ? req.query.agent.trim() : undefined;
    res.json({ success: true, data: analyticsService.compute(range, agent) });
  } catch (err) { next(err); }
});

/** GET /api/chat/conversations — summaries, newest first. */
router.get('/conversations', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: chatService.list() });
  } catch (err) { next(err); }
});

/** POST /api/chat/conversations — create a new conversation. */
router.post('/conversations', (req: Request, res: Response, next: NextFunction) => {
  try {
    const conv = chatService.create(req.body?.title);
    res.status(201).json({ success: true, data: conv });
  } catch (err) { next(err); }
});

/** GET /api/chat/conversations/:id — full conversation with messages. */
router.get('/conversations/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: chatService.get(req.params.id) });
  } catch (err) { next(err); }
});

/** PATCH /api/chat/conversations/:id — rename and/or switch mode (agentId). */
router.patch('/conversations/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    let conv = chatService.get(req.params.id);
    if (typeof req.body?.agentId === 'string') {
      conv = chatService.setAgentId(req.params.id, req.body.agentId);
    }
    if (typeof req.body?.title === 'string') {
      conv = chatService.rename(req.params.id, req.body.title);
    }
    res.json({ success: true, data: conv });
  } catch (err) { next(err); }
});

/** DELETE /api/chat/conversations/:id */
router.delete('/conversations/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    chatService.remove(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** POST /api/chat/conversations/:id/stop — abort in-flight generation. */
router.post('/conversations/:id/stop', (req: Request, res: Response, next: NextFunction) => {
  try {
    const stopped = chatService.stop(req.params.id);
    res.json({ success: true, data: { stopped } });
  } catch (err) { next(err); }
});

/**
 * POST /api/chat/generate — run one generation turn, streaming NDJSON.
 * Body: { conversationId, mode: 'send'|'regenerate'|'continue'|'resume', content?, targetAgentId?, confirmedToolCallIds? }
 */
router.post('/generate', async (req: Request, res: Response) => {
  const { conversationId, mode, content, targetAgentId, temperature, contextLength, confirmedToolCallIds } = req.body as {
    conversationId?: string;
    mode?: GenerateMode;
    content?: string;
    targetAgentId?: string;
    temperature?: number;
    contextLength?: number;
    confirmedToolCallIds?: string[];
  };

  // Generation options come from Settings — clamp to sane ranges
  const temp = typeof temperature === 'number' && Number.isFinite(temperature)
    ? Math.min(2, Math.max(0, temperature)) : undefined;
  const numCtx = typeof contextLength === 'number' && Number.isFinite(contextLength)
    ? Math.min(131_072, Math.max(512, Math.round(contextLength))) : undefined;

  // Validate BEFORE committing to a 200 + streaming headers. flushHeaders()
  // used to run first, so a malformed request came back as HTTP 200 with an
  // error object buried in the stream.
  if (!conversationId) {
    res.status(400).json({ success: false, statusCode: 400, message: '"conversationId" is required' });
    return;
  }
  if (!mode || !['send', 'regenerate', 'continue', 'resume'].includes(mode)) {
    res.status(400).json({
      success: false,
      statusCode: 400,
      message: '"mode" must be one of: send, regenerate, continue, resume',
    });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = (obj: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
  };

  // If the client disconnects mid-stream (e.g. Stop pressed and the
  // fetch aborted), cancel the upstream Ollama generation too.
  res.on('close', () => {
    if (!res.writableEnded && conversationId) chatService.stop(conversationId);
  });

  try {
    await chatService.generate(
      {
        conversationId, mode, content, targetAgentId,
        temperature: temp, contextLength: numCtx,
        confirmedToolCallIds: Array.isArray(confirmedToolCallIds) ? confirmedToolCallIds : undefined,
      },
      {
        onMeta: (meta) => write({ type: 'meta', ...meta }),
        onToken: (token) => write({ type: 'token', token }),
        onDone: (message) => write({ type: 'done', message }),
        onPending: (info) => write({ type: 'pending', ...info }),
        onAgentEvent: (ev) => write({ ...ev }),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write({ type: 'error', message });
  } finally {
    res.end();
  }
});

export default router;
