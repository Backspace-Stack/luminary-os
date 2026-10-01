// ============================================================
// authToken — Optional bearer-token gate for the HTTP API.
//
// Off by default: when API_AUTH_TOKEN is unset (or blank), this
// module exports nothing active and the API behaves exactly as it
// always has. When set, every /api route requires
//   Authorization: Bearer <token>
// and anything missing or wrong gets an honest 401.
//
// /api/health stays open either way: it leaks nothing beyond
// "up + timestamp", and the launcher (scripts/start.js) polls it
// without credentials to decide when the backend is ready —
// gating it would break every run.bat boot.
//
// SECURITY: the expected token is read once at mount time and never
// logged. Comparison is constant-time (crypto.timingSafeEqual) so a
// mismatch reveals nothing about how much of the token was right.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('AuthToken');

/** True when API_AUTH_TOKEN is configured (bridge boot uses this for its warning). */
export function apiAuthEnabled(): boolean {
  return Boolean(process.env.API_AUTH_TOKEN?.trim());
}

/**
 * Returns the auth middleware when API_AUTH_TOKEN is set, else null —
 * the caller simply doesn't mount anything and today's no-auth
 * behaviour is untouched.
 */
export function createAuthTokenMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
  const token = process.env.API_AUTH_TOKEN?.trim();
  if (!token) return null;

  const expected = Buffer.from(token, 'utf8');
  logger.info('API auth token ENABLED — all /api routes (except /api/health) require a Bearer token');

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/health') return next(); // launcher liveness probe

    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const given = Buffer.from(provided, 'utf8');
    const ok = given.length === expected.length && timingSafeEqual(given, expected);

    if (!ok) {
      res.status(401).json({
        success: false,
        statusCode: 401,
        message: 'Unauthorized — a valid "Authorization: Bearer <API_AUTH_TOKEN>" header is required.',
      });
      return;
    }
    next();
  };
}
