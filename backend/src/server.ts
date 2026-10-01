import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { kernel } from './core/kernel/Kernel';
import { router as luminaryRouter } from './router/Router';
import apiRoutes from './routes/index';
import { errorHandler, notFound } from './middleware/errorHandler';
import { createAuthTokenMiddleware } from './middleware/authToken';
import { createAccessControl, assertSafeBind } from './middleware/accessControl';
import { Logger } from './core/logger/Logger';

dotenv.config();

const logger = Logger.scope('Server');
const app = express();
const PORT = Number(process.env.PORT ?? 3001);
// 127.0.0.1 keeps the API off the LAN. Docker Compose overrides this to
// 0.0.0.0 so the container is reachable through its port mapping.
const HOST = process.env.BIND_HOST ?? '127.0.0.1';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

assertSafeBind(HOST, process.env.API_AUTH_TOKEN, FRONTEND_URL);
app.disable('x-powered-by');
app.use(createAccessControl({
  host: HOST, frontendUrl: FRONTEND_URL,
  allowedHosts: (process.env.ALLOWED_HOSTS ?? `localhost:${PORT},127.0.0.1:${PORT},[::1]:${PORT},localhost,127.0.0.1`).split(','),
}));
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
const authToken = createAuthTokenMiddleware();
if (authToken) app.use('/api', authToken);

// Model uploads stream the raw request body to disk — body parsers
// must never consume them, whatever the Content-Type says.
const jsonParser = express.json();
const urlParser = express.urlencoded({ extended: true });
const isRawUpload = (req: express.Request) => req.path.startsWith('/api/models/upload');
app.use((req, res, next) => (isRawUpload(req) ? next() : jsonParser(req, res, next)));
app.use((req, res, next) => (isRawUpload(req) ? next() : urlParser(req, res, next)));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

async function start(): Promise<void> {
  await kernel.boot();
  luminaryRouter.setFallback('conversation-agent');

  // Optional bearer-token gate — active only when API_AUTH_TOKEN is set.
  // Unset ⇒ nothing is mounted and behaviour is unchanged.
  app.use('/api', apiRoutes);
  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(PORT, HOST, () => {
    logger.info('─────────────────────────────────────');
    logger.info(`  Luminary OS API  →  ${HOST}:${PORT}`);
    logger.info(`  Health  →  http://${HOST}:${PORT}/api/health`);
    logger.info(`  Router  →  POST /api/router/send`);
    logger.info(`  Agent tool-loop timeout  →  ${Number(process.env.AGENT_TOOL_TIMEOUT_MS) || 60_000}ms`);
    logger.info('─────────────────────────────────────');
  });

  let shuttingDown = false;
  const shutdown = async () => {
    // A second Ctrl-C used to start a second concurrent shutdown, closing
    // the SQLite handle underneath the first one.
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down gracefully…');
    // Stop accepting connections and let in-flight requests drain BEFORE
    // the kernel closes the DB out from under them. Bounded, so an idle
    // keep-alive socket can't hold the process open forever.
    await Promise.race([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => { setTimeout(resolve, 5_000).unref(); }),
    ]);
    server.closeAllConnections?.();
    await kernel.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});

export default app;
