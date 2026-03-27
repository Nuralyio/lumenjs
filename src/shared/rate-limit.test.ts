import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter, createAuthRateLimiter } from './rate-limit.js';

function createMockReq(ip = '127.0.0.1', url = '/api/test') {
  return {
    url,
    headers: {} as Record<string, string>,
    socket: { remoteAddress: ip },
    method: 'GET',
  };
}

function createMockRes() {
  const headers: Record<string, string> = {};
  let ended = false;
  let statusCode = 200;
  let body = '';
  return {
    writeHead: vi.fn((code: number, hdrs: Record<string, string>) => {
      statusCode = code;
      Object.assign(headers, hdrs);
    }),
    setHeader: vi.fn((key: string, val: string) => { headers[key] = val; }),
    end: vi.fn((b?: string) => { ended = true; body = b || ''; }),
    get _statusCode() { return statusCode; },
    get _headers() { return headers; },
    get _ended() { return ended; },
    get _body() { return body; },
  };
}

describe('rate-limit', () => {
  it('allows requests within limit', () => {
    const limiter = createRateLimiter({ max: 5, windowMs: 60000, skip: () => false });
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    for (let i = 0; i < 5; i++) {
      limiter(req as any, res as any, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
    expect(res._headers['X-RateLimit-Limit']).toBe('5');
  });

  it('blocks requests over limit', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60000, skip: () => false });
    const req = createMockReq();
    const next = vi.fn();

    // First 2 pass
    limiter(req as any, createMockRes() as any, next);
    limiter(req as any, createMockRes() as any, next);
    expect(next).toHaveBeenCalledTimes(2);

    // Third gets blocked
    const res3 = createMockRes();
    limiter(req as any, res3 as any, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res3._statusCode).toBe(429);
    expect(res3._body).toContain('Too many requests');
  });

  it('skips static assets by default', () => {
    const limiter = createRateLimiter({ max: 1 });
    const req = createMockReq('127.0.0.1', '/assets/style.css');
    const res = createMockRes();
    const next = vi.fn();

    // Should skip — static asset
    limiter(req as any, res as any, next);
    limiter(req as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('uses X-Forwarded-For header when present', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60000, skip: () => false });
    const req1 = createMockReq();
    req1.headers['x-forwarded-for'] = '1.2.3.4';
    const req2 = createMockReq();
    req2.headers['x-forwarded-for'] = '5.6.7.8';
    const next = vi.fn();

    limiter(req1 as any, createMockRes() as any, next);
    limiter(req2 as any, createMockRes() as any, next);
    expect(next).toHaveBeenCalledTimes(2); // different IPs
  });

  it('sets Retry-After header on 429', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60000, skip: () => false });
    const req = createMockReq();
    const next = vi.fn();

    limiter(req as any, createMockRes() as any, next);
    const res = createMockRes();
    limiter(req as any, res as any, next);
    expect(res._headers['Retry-After']).toBeDefined();
  });

  it('auth rate limiter has stricter defaults', () => {
    const limiter = createAuthRateLimiter();
    const req = createMockReq();
    const next = vi.fn();

    // Should allow up to 20 requests
    for (let i = 0; i < 20; i++) {
      limiter(req as any, createMockRes() as any, next);
    }
    expect(next).toHaveBeenCalledTimes(20);

    // 21st should be blocked
    const res = createMockRes();
    limiter(req as any, res as any, next);
    expect(res._statusCode).toBe(429);
  });
});
