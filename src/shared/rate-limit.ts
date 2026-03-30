import type { IncomingMessage, ServerResponse } from 'http';

export interface RateLimitConfig {
  /** Time window in milliseconds. Default: 60000 (1 minute). */
  windowMs?: number;
  /** Max requests per window. Default: 100. */
  max?: number;
  /** Custom key generator. Default: IP address. */
  keyGenerator?: (req: IncomingMessage) => string;
  /** Paths to skip rate limiting. Default: static assets. */
  skip?: (req: IncomingMessage) => boolean;
  /** HTTP status code when rate limited. Default: 429. */
  statusCode?: number;
  /** Message sent when rate limited. */
  message?: string;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_CONFIG: Required<RateLimitConfig> = {
  windowMs: 60_000,
  max: 2000,
  keyGenerator: (req) => {
    // Uses X-Forwarded-For when behind a trusted reverse proxy.
    // If directly internet-facing, override keyGenerator to use req.socket.remoteAddress only.
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
  },
  skip: (req) => {
    const url = req.url || '';
    return url.includes('.') && !url.startsWith('/api/');
  },
  statusCode: 429,
  message: 'Too many requests, please try again later.',
};

export function createRateLimiter(config?: RateLimitConfig) {
  const opts = { ...DEFAULT_CONFIG, ...config };
  const buckets = new Map<string, TokenBucket>();
  const refillRate = opts.max / opts.windowMs; // tokens per ms

  // Cleanup stale entries every 5 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > opts.windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, 5 * 60_000);
  cleanupInterval.unref();

  return (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => {
    if (opts.skip(req)) return next();

    const key = opts.keyGenerator(req);
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: opts.max, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(opts.max, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate / 1000);
      res.writeHead(opts.statusCode, {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(opts.max),
        'X-RateLimit-Remaining': '0',
      });
      res.end(JSON.stringify({ error: opts.message }));
      return;
    }

    bucket.tokens -= 1;

    res.setHeader('X-RateLimit-Limit', String(opts.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    next();
  };
}

/** Stricter rate limiter preset for auth endpoints (20 req/min). */
export function createAuthRateLimiter(overrides?: Partial<RateLimitConfig>) {
  return createRateLimiter({
    windowMs: 60_000,
    max: 20,
    skip: () => false,
    ...overrides,
  });
}
