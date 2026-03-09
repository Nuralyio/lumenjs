import http from 'http';
import fs from 'fs';
import path from 'path';
import { readProjectConfig } from '../dev-server/config.js';
import type { BuildManifest } from '../shared/types.js';
import { installDomShims } from '../shared/dom-shims.js';
import { serveStaticFile, sendCompressed } from './serve-static.js';
import { handleApiRoute } from './serve-api.js';
import { handleLoaderRequest, handleLayoutLoaderRequest, handleSubscribeRequest, handleLayoutSubscribeRequest } from './serve-loaders.js';
import { handlePageRoute } from './serve-ssr.js';
import { renderErrorPage } from './error-page.js';
import { handleI18nRequest } from './serve-i18n.js';
import { resolveLocale } from '../dev-server/middleware/locale.js';

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

  if (!fs.existsSync(manifestPath)) {
    console.error('[LumenJS] No build found. Run `lumenjs build` first.');
    process.exit(1);
  }

  const manifest: BuildManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const { title } = readProjectConfig(projectDir);
  const localesDir = path.join(outDir, 'locales');

  // Read the built index.html shell
  const indexHtmlPath = path.join(clientDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    console.error('[LumenJS] No index.html found in build output.');
    process.exit(1);
  }
  const indexHtmlShell = fs.readFileSync(indexHtmlPath, 'utf-8');

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

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const [pathname, queryString] = url.split('?');
    const method = req.method || 'GET';

    try {
      // 1. API routes
      if (pathname.startsWith('/api/')) {
        await handleApiRoute(manifest, serverDir, pathname, queryString, method, req, res);
        return;
      }

      // 2. Static assets — try to serve from client dir
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
        await handleLayoutSubscribeRequest(manifest, serverDir, queryString, req.headers, res);
        return;
      }

      // 5. Subscribe endpoint (SSE)
      if (pathname.startsWith('/__nk_subscribe/')) {
        await handleSubscribeRequest(manifest, serverDir, pagesDir, pathname, queryString, req.headers, res);
        return;
      }

      // 6. Layout loader endpoint
      if (pathname === '/__nk_loader/__layout/' || pathname === '/__nk_loader/__layout') {
        await handleLayoutLoaderRequest(manifest, serverDir, queryString, req.headers, res);
        return;
      }

      // 7. Loader endpoint for client-side navigation
      if (pathname.startsWith('/__nk_loader/')) {
        await handleLoaderRequest(manifest, serverDir, pagesDir, pathname, queryString, req.headers, res);
        return;
      }

      // 6. Resolve locale and strip prefix for page routing
      let resolvedPathname = pathname;
      let locale: string | undefined;
      if (manifest.i18n) {
        const result = resolveLocale(pathname, manifest.i18n, req.headers as any);
        resolvedPathname = result.pathname;
        locale = result.locale;
      }

      // 7. Page routes — SSR render
      await handlePageRoute(manifest, serverDir, pagesDir, resolvedPathname, queryString, indexHtmlShell, title, ssrRuntime, req, res);
    } catch (err: any) {
      console.error('[LumenJS] Request error:', err);
      const html = renderErrorPage(
        500,
        'Something went wrong',
        'An unexpected error occurred while processing your request.',
        process.env.NODE_ENV !== 'production' ? err?.stack || err?.message : undefined
      );
      sendCompressed(req, res, 500, 'text/html; charset=utf-8', html);
    }
  });

  server.listen(port, () => {
    console.log(`[LumenJS] Production server running at http://localhost:${port}`);
  });
}
