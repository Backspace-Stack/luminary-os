import { Router, Request, Response, NextFunction } from 'express';
import { agentService } from '../services/AgentService';

const router = Router();

/** GET /api/agents */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: agentService.listAgents() });
  } catch (err) { next(err); }
});

/** GET /api/agents/:id */
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = agentService.getAgent(req.params.id);
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
    res.json({ success: true, data: agent });
  } catch (err) { next(err); }
});

/** POST /api/agents/:id/activate */
router.post('/:id/activate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = agentService.activateAgent(req.params.id);
    res.json({ success: true, data: agent });
  } catch (err) { next(err); }
});

/** PUT /api/agents/:id/model — assign a real installed model to an agent. */
router.put('/:id/model', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.model !== 'string') {
      return res.status(400).json({ success: false, message: '"model" must be a string' });
    }
    const model = req.body.model.trim();
    if (!model) return res.status(400).json({ success: false, message: '"model" is required' });
    const agent = await agentService.setAgentModel(req.params.id, model);
    res.json({ success: true, data: agent });
  } catch (err) {
    next(err);
  }
});

/** POST /api/agents/:id/pause */
router.post('/:id/pause', (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = agentService.pauseAgent(req.params.id);
    res.json({ success: true, data: agent });
  } catch (err) { next(err); }
});

export default router;
