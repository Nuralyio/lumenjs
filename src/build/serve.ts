import http from 'http';
import fs from 'fs';
import path from 'path';
import { readProjectConfig } from '../dev-server/config.js';
import type { BuildManifest } from '../shared/types.js';
import { installDomShims } from '../shared/dom-shims.js';
import { loadEnvFile } from '../shared/utils.js';
import { serveStaticFile, sendCompressed } from './serve-static.js';
import { handleApiRoute } from './serve-api.js';
import { handleLoaderRequest, handleLayoutLoaderRequest, handleComponentLoaderRequest, handleSubscribeRequest, handleLayoutSubscribeRequest } from './serve-loaders.js';
import { handlePageRoute } from './serve-ssr.js';
import { renderErrorPage } from './error-page.js';
import { handleI18nRequest } from './serve-i18n.js';
import { resolveLocale } from '../dev-server/middleware/locale.js';
import { runMiddlewareChain, extractMiddleware, ConnectMiddleware } from '../shared/middleware-runner.js';
import { loadUserServerMiddleware } from '../shared/user-server-middleware.js';
import { getMiddlewareDirsForPathname, MiddlewareEntry } from './scan.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import { handleAuthRoutes } from '../auth/routes.js';
import { loadAuthConfigProd } from '../auth/config.js';
import { initLogger, logger } from '../shared/logger.js';
import { createSecurityHeadersMiddleware } from '../shared/security-headers.js';
import { createRateLimiter, createAuthRateLimiter } from '../shared/rate-limit.js';
import { createHealthCheckHandler } from '../shared/health.js';
import { createRequestIdMiddleware } from '../shared/request-id.js';
import { getRequestId } from '../shared/request-id.js';
import { setupGracefulShutdown } from '../shared/graceful-shutdown.js';
import { setupSocketIO } from '../shared/socket-io-setup.js';
import crypto from 'crypto';

export interface ServeOptions {
  projectDir: string;
  port?: number;
}

export async function serveProject(options: ServeOptions): Promise<void> {
  const { projectDir } = options;
  const port = options.port || 3000;
  const outDir = path.join(projectDir, '.lumenjs');
  const clientDir = path.join(outDir, 'client');
  const serverDir = path.join(outDir, 'server');
  const manifestPath = path.join(outDir, 'manifest.json');

  // Load .env file (dotenv crashes in ESM context, so we parse manually)
  loadEnvFile(projectDir);

  // Initialize structured logging
  initLogger();

  if (!fs.existsSync(manifestPath)) {
    logger.fatal('No build found. Run `lumenjs build` first.');
    process.exit(1);
  }

  const manifest: BuildManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const config = readProjectConfig(projectDir);
  const { title } = config;
  const localesDir = path.join(outDir, 'locales');

  // Production middleware stack
  const requestIdMiddleware = createRequestIdMiddleware();
  const securityHeaders = createSecurityHeadersMiddleware(config.securityHeaders);
  const rateLimiter = createRateLimiter(config.rateLimit);
  const authRateLimiter = createAuthRateLimiter();
  const healthCheck = createHealthCheckHandler({ version: config.version });

  // Read the built index.html shell
  const indexHtmlPath = path.join(clientDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    logger.fatal('No index.html found in build output.');
    process.exit(1);
  }
  let indexHtmlShell = fs.readFileSync(indexHtmlPath, 'utf-8');
  // Substitute env var placeholders (e.g. __UMAMI_WEBSITE_ID__)
  indexHtmlShell = indexHtmlShell.replace(/__([A-Z0-9_]+)__/g, (_, key) => process.env[key] || '');

  // Load bundled SSR runtime first — its install-global-dom-shim sets up
  // the proper HTMLElement/window/document shims that @lit-labs/ssr needs.
  // The lit-shared chunk handles missing HTMLElement via a fallback to its own shim,
  // so no pre-installation is needed.
  const ssrRuntimePath = path.join(serverDir, 'ssr-runtime.js');
  let ssrRuntime: { render: any; html: any; unsafeStatic: any } | null = null;
  if (fs.existsSync(ssrRuntimePath)) {
    ssrRuntime = await import(ssrRuntimePath);
  }

  // Install additional DOM shims that NuralyUI components may need
  // (must run AFTER SSR runtime so we don't block its window/HTMLElement setup)
  installDomShims();

  const pagesDir = path.join(projectDir, 'pages');

  // Load bundled middleware at startup.
  // A middleware load failure must NOT be silently skipped — a broken
  // `_middleware.ts` may be a security gate (auth check, IP allow-list,
  // admin-only). Silently disabling it would let traffic reach the protected
  // route subtree unprotected. Fail fast, matching the behavior for missing
  // manifest.json / index.html above.
  const middlewareModules: Map<string, ConnectMiddleware[]> = new Map();
  const middlewareLoadFailures: Array<{ dir: string; error: string }> = [];
  if (manifest.middlewares) {
    for (const entry of manifest.middlewares) {
      const modPath = path.join(serverDir, entry.module);
      if (fs.existsSync(modPath)) {
        try {
          const mod = await import(modPath);
          middlewareModules.set(entry.dir, extractMiddleware(mod));
        } catch (err) {
          const message = (err as any)?.message || String(err);
          middlewareLoadFailures.push({ dir: entry.dir || 'root', error: message });
          logger.error(`Failed to load middleware (${entry.dir || 'root'})`, { error: message });
        }
      } else {
        // A middleware declared in the manifest but missing from the server
        // bundle is equally suspicious — treat as a load failure.
        middlewareLoadFailures.push({ dir: entry.dir || 'root', error: `bundled module not found: ${entry.module}` });
        logger.error(`Missing middleware bundle (${entry.dir || 'root'})`, { module: entry.module });
      }
    }
  }
  if (middlewareLoadFailures.length > 0) {
    logger.fatal(
      `Refusing to start: ${middlewareLoadFailures.length} middleware module(s) failed to load. ` +
      `A broken _middleware.ts may be a security gate — silently skipping it could expose protected routes. ` +
      `Fix the import errors and rebuild.`,
      { failures: middlewareLoadFailures }
    );
    process.exit(1);
  }

  const middlewareEntries: MiddlewareEntry[] = manifest.middlewares
    ? manifest.middlewares.map(e => ({ dir: e.dir, filePath: '' }))
    : [];

  // Global user middleware from lumenjs.server.js — applied to every request,
  // including /api/*, /__nk_auth/*, and paths outside the pages/ tree. Runs
  // after security headers / rate limit, before auth and path-scoped _middleware.ts.
  const userServerMiddleware = await loadUserServerMiddleware(projectDir);
  if (userServerMiddleware.length > 0) {
    logger.info(`Loaded ${userServerMiddleware.length} global middleware from lumenjs.server.js`);
  }

  // Load auth config if present
  let authConfig: any = null;
  let authMiddleware: any = null;
  let authDb: any = null;
  if (manifest.auth) {
    try {
      authConfig = await loadAuthConfigProd(serverDir, manifest.auth.configModule);

      // Initialize DB for native auth
      const { hasNativeAuth } = await import('../auth/config.js');
      if (hasNativeAuth(authConfig)) {
        try {
          const { setProjectDir } = await import('../db/context.js');
          const { useDb, waitForMigrations } = await import('../db/index.js');
          const { ensureUsersTable } = await import('../auth/native-auth.js');
          setProjectDir(projectDir);
          authDb = useDb();
          await waitForMigrations();
          await ensureUsersTable(authDb);
          // Run seed if not yet applied (SQLite and PG)
          {
            const seedModule = path.join(serverDir, 'seed.js');
            if (fs.existsSync(seedModule)) {
              try {
                if (authDb.isPg) {
                  await authDb.exec(`CREATE TABLE IF NOT EXISTS _lumen_seed_applied (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
                  )`);
                } else {
                  await authDb.exec(`CREATE TABLE IF NOT EXISTS _lumen_seed_applied (
                    name TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                  )`);
                }
                const seedRow = authDb.isPg
                  ? await authDb.get('SELECT 1 FROM _lumen_seed_applied WHERE name = $1', 'data/seed.ts')
                  : await authDb.get('SELECT 1 FROM _lumen_seed_applied WHERE name = ?', 'data/seed.ts');
                if (!seedRow) {
                  if (authDb.isPg) {
                    await authDb.run('INSERT INTO _lumen_seed_applied (name) VALUES ($1) ON CONFLICT DO NOTHING', 'data/seed.ts');
                  } else {
                    await authDb.run('INSERT OR IGNORE INTO _lumen_seed_applied (name) VALUES (?)', 'data/seed.ts');
                  }
                  logger.info('Running seed file (prod)...');
                  const { default: seedFn } = await import(seedModule);
                  if (typeof seedFn === 'function') await seedFn();
                  logger.info('Seed applied (prod).');
                }
              } catch (seedErr) {
                try {
                  if (authDb.isPg) {
                    await authDb.run('DELETE FROM _lumen_seed_applied WHERE name = $1', 'data/seed.ts');
                  } else {
                    await authDb.run('DELETE FROM _lumen_seed_applied WHERE name = ?', 'data/seed.ts');
                  }
                } catch {}
                logger.warn('Seed failed', { error: (seedErr as any)?.message });
              }
            }
          }
        } catch (dbErr) {
          logger.warn('Native auth DB init failed', { error: (dbErr as any)?.message });
        }
      }

      authMiddleware = createAuthMiddleware(authConfig, authDb);
      logger.info('Auth middleware loaded.');
    } catch (err) {
      logger.error('Failed to load auth config', { error: (err as any)?.message });
    }
  }

  const runMiddleware = (mw: (req: any, res: any, next: any) => void, req: any, res: any): Promise<void> =>
    new Promise((resolve, reject) => mw(req, res, (err?: any) => err ? reject(err) : resolve()));

  const server = http.createServer(async (req, res) => {
    const startTime = Date.now();
    const url = req.url || '/';
    const [pathname, queryString] = url.split('?');
    const method = req.method || 'GET';

    try {
      // --- Production middleware pipeline ---

      // Request ID (always first)
      await runMiddleware(requestIdMiddleware, req, res);

      // Health check (bypass everything else)
      let healthHandled = false;
      await new Promise<void>(resolve => healthCheck(req, res, () => { resolve(); }));
      if (res.writableEnded) return;

      // Security headers
      await runMiddleware(securityHeaders, req, res);

      // Rate limiting (stricter for auth routes)
      if (pathname.startsWith('/__nk_auth/')) {
        await runMiddleware(authRateLimiter, req, res);
      } else {
        await runMiddleware(rateLimiter, req, res);
      }
      if (res.writableEnded) return;

      // Global user middleware (lumenjs.server.js) — runs for ALL request categories,
      // including /api/*, /__nk_auth/*, static paths. Spliced here so it can observe
      // or short-circuit any request, but still sits after rate-limit / security headers.
      if (userServerMiddleware.length > 0) {
        const err: any = await new Promise(resolve =>
          runMiddlewareChain(userServerMiddleware, req, res, resolve)
        );
        if (err) {
          logger.error('User server middleware error', { error: err?.message, stack: err?.stack });
          res.statusCode = 500;
          res.end('Internal Server Error');
          return;
        }
        if (res.writableEnded) return;
      }

      // --- Original request handling ---

      // -2. Auth session middleware (attach req.nkAuth — must run before auth routes and user middleware)
      if (authMiddleware && !pathname.includes('.') && !pathname.startsWith('/@')) {
        await new Promise<void>(resolve => authMiddleware(req, res, resolve));
        if (res.writableEnded) return;
      }

      // 0. Run user middleware chain (runs before auth routes so middleware can gate signup etc.)
      // Map /__nk_loader/ and /__nk_subscribe/ paths back to page paths for middleware matching,
      // so user middleware gates (e.g. admin-only) also protect loader/subscribe data endpoints.
      let middlewarePath = pathname;
      if (pathname.startsWith('/__nk_loader/')) {
        middlewarePath = '/' + pathname.slice('/__nk_loader/'.length);
      } else if (pathname.startsWith('/__nk_subscribe/')) {
        middlewarePath = '/' + pathname.slice('/__nk_subscribe/'.length);
      }
      if (middlewareModules.size > 0 && !pathname.includes('.') &&
          (!pathname.startsWith('/__nk_') || pathname.startsWith('/__nk_auth/') ||
           pathname.startsWith('/__nk_loader/') || pathname.startsWith('/__nk_subscribe/'))) {
        const matching = getMiddlewareDirsForPathname(middlewarePath, middlewareEntries);
        const allMw: ConnectMiddleware[] = [];
        for (const entry of matching) {
          const mws = middlewareModules.get(entry.dir);
          if (mws) allMw.push(...mws);
        }
        if (allMw.length > 0) {
          const err: any = await new Promise(resolve => runMiddlewareChain(allMw, req, res, resolve));
          if (err) { res.statusCode = 500; res.end('Internal Server Error'); return; }
          if (res.writableEnded) return;
        }
      }

      // 1. Auth routes (login, logout, me, signup, etc. — runs after user middleware so invite gate can intercept)
      if (authConfig && pathname.startsWith('/__nk_auth/')) {
        const handled = await handleAuthRoutes(authConfig, req, res, authDb);
        if (handled) return;
      }

      // 2. API routes
      if (pathname.startsWith('/api/')) {
        await handleApiRoute(manifest, serverDir, pathname, queryString, method, req, res);
        return;
      }

      // 2b. Communication file upload
      if (pathname === '/__nk_comm/upload' && method === 'POST') {
        const userId = (req as any).nkAuth?.user?.sub;
        if (!userId) { res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
        const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
        const chunks: Buffer[] = [];
        let uploadSize = 0;
        let aborted = false;
        req.on('data', (c: Buffer) => {
          uploadSize += c.length;
          if (uploadSize > MAX_UPLOAD_SIZE) { aborted = true; req.destroy(); res.statusCode = 413; res.end(JSON.stringify({ error: 'File too large' })); return; }
          chunks.push(c);
        });
        req.on('end', async () => {
          if (aborted) return;
          try {
            const body = Buffer.concat(chunks);
            const id = crypto.randomUUID();
            const fileName = (req.headers['x-filename'] as string) || `file-${id}`;
            const mimeType = (req.headers['content-type'] as string) || 'application/octet-stream';
            const ext = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
            const key = `chat-uploads/${id}${ext}`;

            // Use R2/S3 if configured, otherwise fall back to local disk
            if (process.env.R2_BUCKET && process.env.R2_ENDPOINT) {
              const { S3StorageAdapter } = await import('../storage/adapters/s3.js');
              const s3 = new S3StorageAdapter({
                bucket: process.env.R2_BUCKET,
                region: 'auto',
                accessKeyId: process.env.LUMENJS_S3_ACCESS_KEY || '',
                secretAccessKey: process.env.LUMENJS_S3_SECRET_KEY || '',
                endpoint: process.env.R2_ENDPOINT,
                publicBaseUrl: process.env.R2_PUBLIC_URL,
              });
              const stored = await s3.put(body, { key, mimeType, fileName });
              res.statusCode = 201;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ id, url: stored.url, size: body.length }));
            } else {
              // Local fallback
              const uploadDir = path.join(projectDir, 'data', 'uploads');
              if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
              fs.writeFileSync(path.join(uploadDir, `${id}.bin`), body);
              fs.writeFileSync(path.join(uploadDir, `${id}.meta.json`), JSON.stringify({ id, filename: fileName, mimetype: mimeType, size: body.length }));
              res.statusCode = 201;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ id, url: `/__nk_comm/files/${id}`, size: body.length }));
            }
          } catch (err: any) {
            logger.error('Upload failed', { error: err?.message });
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Upload failed' }));
          }
        });
        return;
      }
      // Serve locally stored files (fallback when R2 is not configured)
      if (pathname.startsWith('/__nk_comm/files/') && method === 'GET') {
        const fileId = pathname.slice('/__nk_comm/files/'.length);
        if (!/^[a-zA-Z0-9._-]+$/.test(fileId)) { res.statusCode = 400; res.end('Invalid file ID'); return; }
        const uploadDir = path.join(projectDir, 'data', 'uploads');
        const filePath = path.resolve(uploadDir, `${fileId}.bin`);
        if (!filePath.startsWith(path.resolve(uploadDir))) { res.statusCode = 400; res.end('Invalid file ID'); return; }
        if (!fs.existsSync(filePath)) { res.statusCode = 404; res.end('File not found'); return; }
        let contentType = 'application/octet-stream';
        try { const meta = JSON.parse(fs.readFileSync(path.resolve(uploadDir, `${fileId}.meta.json`), 'utf-8')); contentType = meta.mimetype || contentType; } catch {}
        const stat = fs.statSync(filePath);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // 3. Static assets — try to serve from client dir (includes pre-generated .md files)
      if (pathname.includes('.')) {
        const served = serveStaticFile(clientDir, pathname, req, res);
        if (served) return;
      }

      // 3. i18n translation endpoint
      if (pathname.startsWith('/__nk_i18n/') && manifest.i18n) {
        handleI18nRequest(localesDir, manifest.i18n.locales, pathname, req, res);
        return;
      }

      // 4. Layout subscribe endpoint (SSE)
      if (pathname === '/__nk_subscribe/__layout/' || pathname === '/__nk_subscribe/__layout') {
        const authUser = (req as any).nkAuth?.user ?? undefined;
        await handleLayoutSubscribeRequest(manifest, serverDir, queryString, req.headers, res, authUser);
        return;
      }

      // 5. Subscribe endpoint (SSE)
      if (pathname.startsWith('/__nk_subscribe/')) {
        await handleSubscribeRequest(manifest, serverDir, pagesDir, pathname, queryString, req.headers, res, (req as any).nkAuth?.user ?? undefined);
        return;
      }

      // 6. Layout loader endpoint
      if (pathname === '/__nk_loader/__layout/' || pathname === '/__nk_loader/__layout') {
        await handleLayoutLoaderRequest(manifest, serverDir, queryString, req.headers, res, (req as any).nkAuth?.user ?? undefined);
        return;
      }

      // 6b. Component loader endpoint
      if (pathname === '/__nk_loader/__component/' || pathname === '/__nk_loader/__component') {
        await handleComponentLoaderRequest(manifest, serverDir, queryString, req.headers, res, (req as any).nkAuth?.user ?? undefined);
        return;
      }

      // 7. Loader endpoint for client-side navigation
      if (pathname.startsWith('/__nk_loader/')) {
        await handleLoaderRequest(manifest, serverDir, pagesDir, pathname, queryString, req.headers, res, (req as any).nkAuth?.user ?? undefined);
        return;
      }

      // 8. Resolve locale and strip prefix for page routing
      let resolvedPathname = pathname;
      let locale: string | undefined;
      if (manifest.i18n) {
        const result = resolveLocale(pathname, manifest.i18n, req.headers as any);
        resolvedPathname = result.pathname;
        locale = result.locale;
      }

      // 9. Check for pre-rendered HTML file
      const prerenderFile = path.join(clientDir, resolvedPathname === '/' ? '' : resolvedPathname, 'index.html');
      if (resolvedPathname !== '/' && fs.existsSync(prerenderFile)) {
        const prerenderHtml = fs.readFileSync(prerenderFile, 'utf-8');
        sendCompressed(req, res, 200, 'text/html; charset=utf-8', prerenderHtml);
        return;
      }

      // Check if the root index.html is a pre-rendered page (has data-nk-ssr attribute)
      if (resolvedPathname === '/') {
        const rootRoute = manifest.routes.find(r => r.path === '/');
        if (rootRoute?.prerender) {
          sendCompressed(req, res, 200, 'text/html; charset=utf-8', indexHtmlShell);
          return;
        }
      }

      // 10. Page routes — SSR render
      await handlePageRoute(manifest, serverDir, pagesDir, resolvedPathname, queryString, indexHtmlShell, title, ssrRuntime, req, res);
    } catch (err: any) {
      logger.error('Request error', {
        method, url: pathname, error: err?.message, stack: err?.stack,
        requestId: getRequestId(req),
      });
      const html = renderErrorPage(
        500,
        'Something went wrong',
        'An unexpected error occurred while processing your request.',
        process.env.NODE_ENV !== 'production' ? err?.stack || err?.message : undefined
      );
      sendCompressed(req, res, 500, 'text/html; charset=utf-8', html);
    } finally {
      // Log request completion
      const duration = Date.now() - startTime;
      logger.request(req, res.statusCode, duration, { requestId: getRequestId(req) });
    }
  });

  // Socket.IO setup (attach before listen so it shares the HTTP server)
  const socketRoutes = manifest.routes
    .filter(r => r.hasSocket && r.module)
    .map(r => ({ path: r.path, hasSocket: true, filePath: path.join(serverDir, r.module) }));
  if (socketRoutes.length > 0) {
    setupSocketIO({
      httpServer: server,
      loadModule: (fp) => import(fp),
      routes: socketRoutes,
      projectDir,
    }).catch((err: any) => {
      logger.warn('Socket.IO setup failed', { error: err?.message });
    });
  }

  // Graceful shutdown
  setupGracefulShutdown(server, {
    onShutdown: async () => {
      logger.info('Cleaning up resources...');
    },
  });

  server.listen(port, () => {
    logger.info(`Production server running at http://localhost:${port}`, { port });
  });
}
