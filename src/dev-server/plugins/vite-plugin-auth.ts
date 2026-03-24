import path from 'path';
import { Plugin } from 'vite';
import type { ResolvedAuthConfig } from '../../auth/types.js';
import { loadAuthConfig } from '../../auth/config.js';
import { createAuthMiddleware } from '../../auth/middleware.js';
import { handleAuthRoutes } from '../../auth/routes.js';
import { enforceGuard } from '../../auth/guard.js';
import { hasNativeAuth } from '../../auth/config.js';
import { loadEmailConfig, sendEmail, renderEmailTemplate } from '../../email/index.js';
import { setProjectDir } from '../../db/context.js';
import { useDb } from '../../db/index.js';
import { ensureUsersTable } from '../../auth/native-auth.js';

/**
 * Vite dev plugin for authentication.
 * Registers auth session middleware, auth route handlers, and guard enforcement.
 */
export function authPlugin(projectDir: string): Plugin {
  let authConfig: ResolvedAuthConfig | null = null;
  let db: any = null;

  return {
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
                ensureUsersTable(db);
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

        const middleware = createAuthMiddleware(authConfig);
        middleware(req, res, next);
      });

      // 2. Auth route handlers — login, callback, logout, me
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

      // 3. Guard enforcement — check page auth export, redirect/403
      server.middlewares.use(async (req, res, next) => {
        if (!authConfig) return next();
        const url = req.url || '';

        // Only enforce on page requests (no static files, no API, no internal)
        if (url.includes('.') || url.startsWith('/@') || url.startsWith('/__nk_') || url.startsWith('/api/') || url.startsWith('/node_modules')) {
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

          const result = enforceGuard(authExport, (req as any).nkAuth, authConfig.routes.loginPage, url);

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
}
