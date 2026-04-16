import path from 'path';
import { Plugin } from 'vite';
import type { ResolvedAuthConfig } from '../../auth/types.js';
import { loadAuthConfig } from '../../auth/config.js';
import { createAuthMiddleware } from '../../auth/middleware.js';
import { handleAuthRoutes } from '../../auth/routes.js';
import { enforceGuard } from '../../auth/guard.js';
import { hasNativeAuth } from '../../auth/config.js';
import { enforcePermissionGuard, isPermissionGuard } from '../../permissions/guard.js';
import { ensurePermissionTables } from '../../permissions/tables.js';
import { PermissionService } from '../../permissions/service.js';
import { loadEmailConfig, sendEmail, renderEmailTemplate } from '../../email/index.js';
import { setProjectDir } from '../../db/context.js';
import { useDb, waitForMigrations } from '../../db/index.js';
import { ensureUsersTable } from '../../auth/native-auth.js';

import fs from 'fs';
import type { LumenDb } from '../../db/index.js';

/** Run seed.ts via Vite ssrLoadModule so TypeScript is handled. Only runs once per DB. */
async function runPgSeedIfNeeded(server: any, db: LumenDb, projectDir: string): Promise<void> {
  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  if (!fs.existsSync(seedPath)) return;
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS _lumen_seed_applied (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    const row = await db.get('SELECT 1 FROM _lumen_seed_applied WHERE name = $1', 'data/seed.ts');
    if (row) return;
    await db.run('INSERT INTO _lumen_seed_applied (name) VALUES ($1) ON CONFLICT DO NOTHING', 'data/seed.ts');
    console.log('[LumenJS] Running seed file (PG)...');
    const mod = await server.ssrLoadModule(seedPath);
    const seedFn = mod.default || mod;
    if (typeof seedFn === 'function') await seedFn();
    console.log('[LumenJS] Seed applied (PG).');
  } catch (err: any) {
    try { await db.run('DELETE FROM _lumen_seed_applied WHERE name = $1', 'data/seed.ts'); } catch {}
    console.error('[LumenJS] PG seed failed:', err.message);
  }
}

/**
 * Extract URL params by matching a route pattern against a path.
 * Pattern: /apps/workflows/:workflowId → { workflowId: 'abc-123' }
 */
function matchRouteParams(pattern: string, pathname: string): Record<string, string> {
  const params: Record<string, string> = {};
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      const key = patternParts[i].slice(1);
      if (pathParts[i]) params[key] = decodeURIComponent(pathParts[i]);
    }
  }
  return params;
}

/**
 * Vite dev plugins for authentication.
 *
 * Split into two plugins to match production middleware ordering (see
 * `libs/lumenjs/src/build/serve.ts:218-253`):
 *
 *   1. Auth session middleware (attach req.nkAuth) — BEFORE user middleware
 *   2. User middleware chain                        — runs in between (registered by server.ts)
 *   3. Auth route handler (/__nk_auth/*)            — AFTER user middleware, so
 *      gates like invite-only signup can intercept /__nk_auth/signup
 *
 * Vite registers `configureServer` middleware as pre-hooks in plugin order, so
 * emitting two separate plugins lets `lumenjs-user-middleware` slot between
 * them. Both plugins share config/db state via the closure below.
 *
 * Returns `{ pre, post }`:
 *   - `pre`  — session middleware + page guard enforcement + `transform`
 *              (strips `export const auth` from client bundles)
 *   - `post` — /__nk_auth/* route handler
 */
export function authPlugin(projectDir: string): { pre: Plugin; post: Plugin } {
  let authConfig: ResolvedAuthConfig | null = null;
  let db: any = null;
  let permissionService: PermissionService | null = null;

  const pre: Plugin = {
    name: 'lumenjs-auth',
    configureServer(server) {
      // 1. Auth session middleware — parse cookie, attach req.nkAuth
      server.middlewares.use(async (req, res, next) => {
        if (!authConfig) {
          try {
            authConfig = await loadAuthConfig(projectDir, server.ssrLoadModule.bind(server));
            // Auto-wire email sending if email plugin is configured and auth has no custom onEvent
            if (authConfig && !authConfig.onEvent) {
              try {
                const emailConfig = await loadEmailConfig(projectDir, server.ssrLoadModule.bind(server));
                if (emailConfig) {
                  const { readProjectConfig } = await import('../../dev-server/config.js');
                  const appName = readProjectConfig(projectDir).title;
                  authConfig.onEvent = async (event) => {
                    try {
                      const data = { appName, url: event.type === 'password-changed' ? '' : (event as any).url, email: event.email };
                      if (event.type === 'verification-email') {
                        const html = renderEmailTemplate(emailConfig, 'verify-email', data);
                        if (html) await sendEmail(emailConfig, { to: event.email, subject: `Verify your email - ${appName}`, html });
                      } else if (event.type === 'password-reset') {
                        const html = renderEmailTemplate(emailConfig, 'password-reset', data);
                        if (html) await sendEmail(emailConfig, { to: event.email, subject: `Reset your password - ${appName}`, html });
                      }
                    } catch (emailErr) {
                      console.error('[LumenJS Email] Failed to send:', (emailErr as any)?.message);
                    }
                  };
                  console.log('[LumenJS] Email auto-wired with auth module');
                }
              } catch {}
            }
            // Initialize DB for native auth
            if (authConfig && hasNativeAuth(authConfig) && !db) {
              try {
                setProjectDir(projectDir);
                db = useDb();
                await waitForMigrations();
                // Run PG seed via ssrLoadModule so TypeScript is handled
                if (db.isPg) {
                  await runPgSeedIfNeeded(server, db, projectDir);
                }
                await ensureUsersTable(db);
                if (authConfig.permissions.enabled) {
                  await ensurePermissionTables(db);
                  permissionService = new PermissionService(db, authConfig.permissions);
                  console.log('[LumenJS] Permission module initialized');
                }
              } catch (dbErr) {
                console.warn('[LumenJS Auth] DB init failed, native auth disabled:', (dbErr as any)?.message);
              }
            }
          } catch (err) {
            console.error('[LumenJS Auth] Failed to load config:', err);
            return next();
          }
        }
        if (!authConfig) return next();

        const middleware = createAuthMiddleware(authConfig, db);
        middleware(req, res, next);
      });

      // 2. Guard enforcement — check page auth export, redirect/403.
      // Does NOT touch /__nk_auth/* (short-circuits via the /__nk_ prefix check
      // below), so ordering relative to user middleware is irrelevant here.
      server.middlewares.use(async (req, res, next) => {
        if (!authConfig) return next();
        const url = req.url || '';

        // Only enforce on page requests (no static files, no API, no internal)
        const lastSegment = url.split('?')[0].split('/').pop() || '';
        const isStaticFile = lastSegment.includes('.') && /\.\w{1,10}$/.test(lastSegment);
        if (isStaticFile || url.startsWith('/@') || url.startsWith('/__nk_') || url.startsWith('/api/') || url.startsWith('/node_modules')) {
          return next();
        }

        try {
          const pagesDir = path.join(projectDir, 'pages');
          const { resolvePageFile } = await import('./vite-plugin-loaders.js');
          const pageFile = resolvePageFile(pagesDir, url.split('?')[0]);
          if (!pageFile) return next();

          const mod = await server.ssrLoadModule(pageFile);
          const authExport = mod.auth ?? (authConfig.guards.defaultAuth ? true : null);

          if (!authExport) return next();

          // Permission guard: { permission: 'workflow:read', resourceParam: 'workflowId' }
          let result;
          if (isPermissionGuard(authExport) && permissionService) {
            // Extract URL params from the page file path pattern
            const { filePathToRoute } = await import('../../shared/utils.js');
            const routePattern = filePathToRoute(path.relative(pagesDir, pageFile));
            const urlParams = matchRouteParams(routePattern, url.split('?')[0]);
            result = await enforcePermissionGuard(
              authExport,
              (req as any).nkAuth?.user,
              authConfig.routes.loginPage,
              url,
              urlParams,
              permissionService,
            );
          } else {
            result = enforceGuard(authExport, (req as any).nkAuth, authConfig.routes.loginPage, url);
          }

          if ('redirect' in result) {
            res.writeHead(302, { Location: result.redirect });
            res.end();
            return;
          }
          if ('forbidden' in result) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
          }

          next();
        } catch (guardErr) {
          console.error('[LumenJS Auth] Guard error:', (guardErr as any)?.message);
          next();
        }
      });
    },

    // Strip `export const auth = ...` from client code and add __nk_has_auth flag
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return;
      const pagesDir = path.join(projectDir, 'pages');
      if (!id.startsWith(pagesDir)) return;
      if (!/export\s+const\s+auth\s*=/.test(code)) return;

      // Strip the auth export statement
      let transformed = code.replace(/export\s+const\s+auth\s*=\s*[^;]+;/g, '');

      // Add client-side flags
      transformed += '\nexport const __nk_has_auth = true;\n';

      return { code: transformed, map: null };
    },
  };

  const post: Plugin = {
    name: 'lumenjs-auth-routes',
    configureServer(server) {
      // 3. Auth route handlers — login, callback, logout, me, signup, etc.
      // Registered AFTER `lumenjs-user-middleware` so user middleware can gate
      // /__nk_auth/signup (invite codes, email allow-lists) before the handler
      // sends the response. Matches the prod ordering in build/serve.ts:249-253.
      server.middlewares.use(async (req, res, next) => {
        if (!authConfig) return next();
        const url = req.url || '';
        if (!url.startsWith('/__nk_auth/')) return next();

        try {
          const handled = await handleAuthRoutes(authConfig, req, res, db);
          if (!handled) next();
        } catch (err) {
          console.error('[LumenJS Auth] Route handler error:', err);
          next();
        }
      });
    },
  };

  return { pre, post };
}
