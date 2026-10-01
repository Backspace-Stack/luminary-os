import type { RequestHandler } from 'express';

const loopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);

export function assertSafeBind(host: string, token: string | undefined, frontendUrl: string): void {
  const origin = new URL(frontendUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== frontendUrl || origin.username || origin.password) {
    throw new Error('FRONTEND_URL must be one explicit HTTP(S) origin.');
  }
  if (!loopback(host) && !token?.trim()) throw new Error('A non-loopback BIND_HOST requires API_AUTH_TOKEN.');
}

/** CORS alone does not prevent hostile webpages from sending mutations. */
export function createAccessControl(options: { host: string; frontendUrl: string; allowedHosts: string[] }): RequestHandler {
  const hosts = new Set(options.allowedHosts.map(h => h.trim().toLowerCase()));
  return (req, res, next) => {
    if (loopback(options.host) && !hosts.has((req.headers.host ?? '').toLowerCase())) {
      res.status(403).json({ success: false, message: 'Request host is not allowed.' }); return;
    }
    const origin = req.headers.origin;
    if ((origin && origin !== options.frontendUrl) || (!origin && req.headers['sec-fetch-site'] === 'cross-site')) {
      res.status(403).json({ success: false, message: 'Request origin is not allowed.' }); return;
    }
    next();
  };
}
