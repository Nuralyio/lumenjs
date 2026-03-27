import { describe, it, expect, vi } from 'vitest';
import { createRequestIdMiddleware, getRequestId } from './request-id.js';

describe('request-id', () => {
  it('generates a UUID request ID', () => {
    const mw = createRequestIdMiddleware();
    const req: any = { headers: {} };
    const res: any = { setHeader: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
  });

  it('reuses existing X-Request-ID header', () => {
    const mw = createRequestIdMiddleware();
    const req: any = { headers: { 'x-request-id': 'existing-id-123' } };
    const res: any = { setHeader: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(req.id).toBe('existing-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'existing-id-123');
  });

  it('getRequestId returns the ID from req', () => {
    const req: any = { id: 'test-id' };
    expect(getRequestId(req)).toBe('test-id');
  });

  it('getRequestId returns undefined for requests without ID', () => {
    expect(getRequestId({} as any)).toBeUndefined();
  });
});
