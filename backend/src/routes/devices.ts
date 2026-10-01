import { Router, Request, Response, NextFunction } from 'express';
import { deviceService } from '../services/DeviceService';

const router = Router();

/** GET /api/devices?type=camera&status=connected */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = deviceService.listDevices({
      type:   req.query.type   as string,
      status: req.query.status as string,
    });
    res.json({ success: true, data, total: data.length });
  } catch (err) { next(err); }
});

/** GET /api/devices/:id */
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const device = deviceService.getDevice(req.params.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
});

/** POST /api/devices/:id/connect */
router.post('/:id/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const device = await deviceService.connect(req.params.id);
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
});

/** POST /api/devices/:id/disconnect */
router.post('/:id/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const device = await deviceService.disconnect(req.params.id);
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
});

/** GET /api/devices/stats */
router.get('/stats/summary', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: deviceService.stats() });
  } catch (err) { next(err); }
});

export default router;
