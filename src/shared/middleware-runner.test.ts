import { describe, it, expect, vi } from 'vitest';
import { runMiddlewareChain, extractMiddleware, ConnectMiddleware } from './middleware-runner.js';

describe('runMiddlewareChain', () => {
  it('calls done immediately for empty middleware array', () => {
    const done = vi.fn();
    runMiddlewareChain([], {}, {}, done);
    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith();
  });

  it('executes a single middleware and calls done', () => {
    const done = vi.fn();
    const mw: ConnectMiddleware = (_req, _res, next) => next();
    runMiddlewareChain([mw], {}, {}, done);
    expect(done).toHaveBeenCalledOnce();
  });

  it('executes multiple middlewares in order', () => {
    const order: number[] = [];
    const done = vi.fn();
    const mw1: ConnectMiddleware = (_req, _res, next) => { order.push(1); next(); };
    const mw2: ConnectMiddleware = (_req, _res, next) => { order.push(2); next(); };
    const mw3: ConnectMiddleware = (_req, _res, next) => { order.push(3); next(); };
    runMiddlewareChain([mw1, mw2, mw3], {}, {}, done);
    expect(order).toEqual([1, 2, 3]);
    expect(done).toHaveBeenCalledOnce();
  });

  it('short-circuits when middleware calls next with an error', () => {
    const done = vi.fn();
    const error = new Error('middleware error');
    const mw1: ConnectMiddleware = (_req, _res, next) => next(error);
    const mw2: ConnectMiddleware = vi.fn((_req, _res, next) => next());
    runMiddlewareChain([mw1, mw2], {}, {}, done);
    expect(done).toHaveBeenCalledWith(error);
    expect(mw2).not.toHaveBeenCalled();
  });

  it('catches synchronous throws and passes error to done', () => {
    const done = vi.fn();
    const error = new Error('sync throw');
    const mw: ConnectMiddleware = () => { throw error; };
    runMiddlewareChain([mw], {}, {}, done);
    expect(done).toHaveBeenCalledWith(error);
  });

  it('passes req/res modifications to subsequent middlewares', () => {
    const done = vi.fn();
    const req: any = {};
    const res: any = {};
    const mw1: ConnectMiddleware = (r, _res, next) => { r.user = 'alice'; next(); };
    const mw2: ConnectMiddleware = (_req, s, next) => { s.statusCode = 200; next(); };
    runMiddlewareChain([mw1, mw2], req, res, done);
    expect(req.user).toBe('alice');
    expect(res.statusCode).toBe(200);
    expect(done).toHaveBeenCalledOnce();
  });

  it('stalls when middleware never calls next', () => {
    const done = vi.fn();
    const mw: ConnectMiddleware = () => { /* never calls next */ };
    runMiddlewareChain([mw], {}, {}, done);
    expect(done).not.toHaveBeenCalled();
  });

  it('catches async middleware rejections and passes error to done', async () => {
    const done = vi.fn();
    const error = new Error('async throw');
    const mw: ConnectMiddleware = (async () => { throw error; }) as any;
    runMiddlewareChain([mw], {}, {}, done);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(done).toHaveBeenCalledWith(error);
  });

  it('handles async middleware that resolves normally', async () => {
    const done = vi.fn();
    const mw: ConnectMiddleware = (async (_req, _res, next) => { next(); }) as any;
    runMiddlewareChain([mw], {}, {}, done);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(done).toHaveBeenCalledOnce();
  });
});

describe('extractMiddleware', () => {
  it('returns array from module default export', () => {
    const fn1: ConnectMiddleware = (_req, _res, next) => next();
    const fn2: ConnectMiddleware = (_req, _res, next) => next();
    const mod = { default: [fn1, fn2] };
    expect(extractMiddleware(mod)).toEqual([fn1, fn2]);
  });

  it('returns array when module itself is an array of functions', () => {
    const fn1: ConnectMiddleware = (_req, _res, next) => next();
    expect(extractMiddleware([fn1])).toEqual([fn1]);
  });

  it('returns empty array when default is not an array', () => {
    expect(extractMiddleware({ default: 'not-an-array' })).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(extractMiddleware(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(extractMiddleware(undefined)).toEqual([]);
  });

  it('filters out non-function values from array', () => {
    const fn: ConnectMiddleware = (_req, _res, next) => next();
    const mod = { default: [fn, 'string', 42, null, fn] };
    expect(extractMiddleware(mod)).toEqual([fn, fn]);
  });

  it('returns only functions from mixed array', () => {
    const fn: ConnectMiddleware = (_req, _res, next) => next();
    const result = extractMiddleware({ default: [fn, true, {}, fn] });
    expect(result).toHaveLength(2);
    result.forEach(item => expect(typeof item).toBe('function'));
  });
});
