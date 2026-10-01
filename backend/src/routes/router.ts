// ============================================================
// POST /api/router — The single entry point for all user messages.
//
// The UI sends every chat message here. The service resolves
// the correct agent via the Router and returns its response.
// The UI never needs to know which agent handled the request.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { agentService } from '../services/AgentService';
import { randomUUID } from 'crypto';

const router = Router();

export interface RouteRequestBody {
  content: string;
  sessionId?: string;
  targetAgentId?: string;
  /**
   * Approval tokens from a prior response's `pendingConfirmations`.
   * Resend the original message with these filled to resume a tool loop
   * that paused for confirmation and run the approved actions.
   */
  confirmedToolCallIds?: string[];
}

/**
 * POST /api/router/send
 * Route a user message to the appropriate agent.
 *
 * Body: { content, sessionId?, targetAgentId? }
 */
router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, sessionId, targetAgentId, confirmedToolCallIds } = req.body as RouteRequestBody;

    if (!content?.trim()) {
      return res.status(400).json({ success: false, message: '"content" is required' });
    }

    const response = await agentService.routeMessage(
      content.trim(),
      sessionId ?? randomUUID(),
      targetAgentId,
      Array.isArray(confirmedToolCallIds) ? confirmedToolCallIds : undefined,
    );

    res.json({ success: true, data: response });
  } catch (err) { next(err); }
});

/**
 * POST /api/router/preview
 * Returns which agent *would* handle a message — no execution.
 * Used by the UI to show routing hints.
 */
router.post('/preview', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body as { content: string };
    if (!content?.trim()) {
      return res.status(400).json({ success: false, message: '"content" is required' });
    }
    const preview = agentService.previewRouting(content.trim());
    res.json({ success: true, data: preview });
  } catch (err) { next(err); }
});

export default router;
