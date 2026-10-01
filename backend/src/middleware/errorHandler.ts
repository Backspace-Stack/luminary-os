import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
};

export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  // Nothing can be written to a response that already started (a streaming
  // NDJSON turn, or a client that disconnected mid-research) — hand it to
  // Express's default handler, which closes the socket instead of throwing.
  if (res.headersSent || res.writableEnded) return next(err);

  // res.status() throws RangeError on anything outside 100-599, and this app
  // constructs errors with statusCode 0 for "backend unreachable".
  const raw = Number(err.statusCode);
  const statusCode = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
  // Errors that declare a status code (AppError, OllamaError,
  // ChatError, RouterError…) are operational — surface their real
  // message so the UI can show honest failure states.
  const message = err.isOperational || typeof err.statusCode === 'number'
    ? err.message
    : 'Internal server error';

  if (process.env.NODE_ENV !== 'production') {
    console.error('[ERROR]', err);
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};
