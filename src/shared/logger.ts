import { IncomingMessage } from 'http';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
  fatal: '\x1b[35m',  // magenta
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

export interface LogEntry {
  level: LogLevel;
  msg: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
}

let globalLevel: LogLevel = 'info';
let globalJson = false;

export function configureLogger(opts: LoggerOptions): void {
  if (opts.level) globalLevel = opts.level;
  if (opts.json !== undefined) globalJson = opts.json;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[globalLevel];
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function formatPretty(entry: LogEntry): string {
  const { level, msg, timestamp, ...extra } = entry;
  const color = LEVEL_COLORS[level];
  const ts = `${DIM}${timestamp}${RESET}`;
  const lvl = `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
  const extraStr = Object.keys(extra).length > 0
    ? ` ${DIM}${JSON.stringify(extra)}${RESET}`
    : '';
  return `${ts} ${lvl} ${msg}${extraStr}`;
}

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  const formatted = globalJson ? formatJson(entry) : formatPretty(entry);

  if (level === 'error' || level === 'fatal') {
    process.stderr.write(formatted + '\n');
  } else {
    process.stdout.write(formatted + '\n');
  }
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => log('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra),
  fatal: (msg: string, extra?: Record<string, unknown>) => log('fatal', msg, extra),

  /** Create a child logger with preset extra fields (e.g. requestId). */
  child(fields: Record<string, unknown>) {
    return {
      debug: (msg: string, extra?: Record<string, unknown>) => log('debug', msg, { ...fields, ...extra }),
      info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, { ...fields, ...extra }),
      warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, { ...fields, ...extra }),
      error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, { ...fields, ...extra }),
      fatal: (msg: string, extra?: Record<string, unknown>) => log('fatal', msg, { ...fields, ...extra }),
    };
  },

  /** Log an HTTP request completion. */
  request(req: IncomingMessage, statusCode: number, durationMs: number, extra?: Record<string, unknown>) {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    log(level, `${req.method} ${req.url} ${statusCode} ${durationMs}ms`, {
      method: req.method,
      url: req.url,
      status: statusCode,
      duration: durationMs,
      ...extra,
    });
  },
};

/** Auto-configure from environment. Call once at startup. */
export function initLogger(): void {
  const isProd = process.env.NODE_ENV === 'production';
  configureLogger({
    level: (process.env.LOG_LEVEL as LogLevel) || (isProd ? 'info' : 'debug'),
    json: process.env.LOG_FORMAT === 'json' || isProd,
  });
}
