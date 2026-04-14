export type ConnectMiddleware = (req: any, res: any, next: (err?: any) => void) => void;

/**
 * Chain Connect-style (req, res, next) middleware functions sequentially.
 */
export function runMiddlewareChain(
  middlewares: ConnectMiddleware[],
  req: any,
  res: any,
  done: (err?: any) => void
): void {
  let index = 0;

  function next(err?: any): void {
    if (err) return done(err);
    if (index >= middlewares.length) return done();
    const mw = middlewares[index++];
    try {
      const result = mw(req, res, next);
      if (result && typeof (result as any).catch === 'function') {
        (result as any).catch((e: any) => done(e));
      }
    } catch (e) {
      done(e);
    }
  }

  next();
}

/**
 * Validate and extract middleware array from a module's default export.
 */
export function extractMiddleware(mod: any): ConnectMiddleware[] {
  const arr = mod?.default ?? mod;
  if (!Array.isArray(arr)) return [];
  return arr.filter((fn: any) => {
    if (typeof fn !== 'function') return false;
    if (fn.length === 4) {
      console.warn('[LumenJS] Skipping error middleware (4 args) — not supported. Use standard (req, res, next) middleware.');
      return false;
    }
    return true;
  });
}
