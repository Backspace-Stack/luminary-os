// ============================================================
// Logger — Structured, levelled logger for Luminary OS.
//
// Every module creates a scoped logger: Logger.scope('Router').
// In production this would pipe to a log aggregator.
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '\x1b[90m', // grey
  info:  '\x1b[36m', // cyan
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';

export class Logger {
  private static minLevel: LogLevel =
    (process.env.LOG_LEVEL as LogLevel) ?? 'info';

  private constructor(private readonly scope: string) {}

  static scope(scope: string): Logger {
    return new Logger(scope);
  }

  static setLevel(level: LogLevel): void {
    Logger.minLevel = level;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[Logger.minLevel]) return;

    const entry: LogEntry = {
      level,
      scope: this.scope,
      message,
      meta,
      timestamp: new Date().toISOString(),
    };

    const color = LEVEL_COLOR[level];
    const prefix = `${color}[${level.toUpperCase().padEnd(5)}]${RESET}`;
    const scopeStr = `\x1b[35m[${this.scope}]${RESET}`;
    const metaStr = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';

    console.log(`${prefix} ${scopeStr} ${message}${metaStr}`);

    // Future: emit to EventBus for log aggregation
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }
}
