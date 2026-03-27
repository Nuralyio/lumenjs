import { describe, it, expect, vi } from 'vitest';
import { createHealthCheckHandler } from './health.js';

function createMockRes() {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string> = {};
  return {
    writeHead: vi.fn((code: number, hdrs: Record<string, string>) => {
      statusCode = code;
      Object.assign(headers, hdrs);
    }),
    end: vi.fn((b?: string) => { body = b || ''; }),
    get _statusCode() { return statusCode; },
    get _body() { return body; },
    get _headers() { return headers; },
  };
}

describe('health', () => {
  it('responds to /__health with health data', () => {
    const handler = createHealthCheckHandler({ version: '1.2.3' });
    const req: any = { url: '/__health' };
    const res = createMockRes();
    const next = vi.fn();

    handler(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.2.3');
    expect(body.uptime).toBeTypeOf('number');
    expect(body.timestamp).toBeDefined();
    expect(body.memory).toBeDefined();
  });

  it('passes through non-health requests', () => {
    const handler = createHealthCheckHandler();
    const req: any = { url: '/api/something' };
    const res = createMockRes();
    const next = vi.fn();

    handler(req, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('supports custom path', () => {
    const handler = createHealthCheckHandler({ path: '/healthz' });
    const req: any = { url: '/healthz' };
    const res = createMockRes();
    const next = vi.fn();

    handler(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(200);
  });

  it('strips query string when matching path', () => {
    const handler = createHealthCheckHandler();
    const req: any = { url: '/__health?verbose=true' };
    const res = createMockRes();
    const next = vi.fn();

    handler(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(200);
  });
});
