import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { extractMiddleware, ConnectMiddleware } from './middleware-runner.js';

/**
 * Load user-defined global Connect middleware from `lumenjs.server.js` at the project root.
 *
 * The module should export an array of Connect-style `(req, res, next)` middleware functions
 * (or a single function) as its default export. These run globally in both dev and prod,
 * spliced after built-in security/rate-limit and before auth — giving apps a place to register
 * cross-cutting middleware (body parser, proxy, tracing, feature flags, CORS) that covers every
 * request category including `/api/*`, `/__nk_auth/*`, and paths outside `pages/`.
 *
 * This complements `lumenjs.plugins.js`, which is dev-only and runs under Vite. A Vite plugin's
 * `configureServer()` hook never fires in `lumenjs serve` (no Vite in prod), so a separate
 * convention is needed to register middleware that behaves the same in dev and prod.
 */
export async function loadUserServerMiddleware(projectDir: string): Promise<ConnectMiddleware[]> {
  const candidates = ['lumenjs.server.js', 'lumenjs.server.mjs'];
  for (const name of candidates) {
    const filePath = path.join(projectDir, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const mod = await import(pathToFileURL(filePath).href);
      return extractMiddleware(mod);
    } catch (err) {
      console.warn(`[LumenJS] Failed to load ${name}:`, (err as any)?.message);
      return [];
    }
  }
  return [];
}
