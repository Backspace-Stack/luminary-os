import { Router } from 'express';
import systemRoutes  from './system';
import agentRoutes   from './agents';
import modelRoutes   from './models';
import memoryRoutes  from './memory';
import notesRoutes   from './notes';
import deviceRoutes  from './devices';
import routerRoutes  from './router';
import chatRoutes    from './chat';
import settingsRoutes from './settings';
import integrationRoutes from './integrations';

const api = Router();

api.use('/system',   systemRoutes);
api.use('/agents',   agentRoutes);
api.use('/models',   modelRoutes);
api.use('/memory',   memoryRoutes);
api.use('/notes',    notesRoutes);
api.use('/devices',  deviceRoutes);
api.use('/router',   routerRoutes);
api.use('/chat',     chatRoutes);
api.use('/settings', settingsRoutes);
api.use('/integrations', integrationRoutes);

api.get('/health', (_req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

export default api;
