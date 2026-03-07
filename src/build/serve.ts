import http from 'http';
import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import { readProjectConfig } from '../dev-server/server.js';

export interface ServeOptions {
  projectDir: string;
  port?: number;
}

interface ManifestRoute {
  path: string;
  module: string;
  hasLoader: boolean;
}

interface BuildManifest {
  routes: ManifestRoute[];
  apiRoutes: ManifestRoute[];
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

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

  // Read the built index.html shell
  const indexHtmlPath = path.join(clientDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    console.error('[LumenJS] No index.html found in build output.');
    process.exit(1);
  }
  const indexHtmlShell = fs.readFileSync(indexHtmlPath, 'utf-8');

  // Load bundled SSR runtime first — it installs @lit-labs/ssr DOM shim
  // which must be in place before any Lit class is instantiated.
  const ssrRuntimePath = path.join(serverDir, 'ssr-runtime.js');
  let ssrRuntime: { render: any; html: any; unsafeStatic: any } | null = null;
  if (fs.existsSync(ssrRuntimePath)) {
    ssrRuntime = await import(ssrRuntimePath);
  }

  // Install additional DOM shims that NuralyUI components may need
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

      // 3. Loader endpoint for client-side navigation
      if (pathname.startsWith('/__nk_loader/')) {
        await handleLoaderRequest(manifest, serverDir, pagesDir, pathname, queryString, req.headers, res);
        return;
      }

      // 4. Page routes — SSR render
      await handlePageRoute(manifest, serverDir, pagesDir, pathname, queryString, indexHtmlShell, title, ssrRuntime, req, res);
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

function installDomShims() {
  const g = globalThis as any;
  const noop = () => null;

  if (!g.HTMLElement) {
    g.HTMLElement = class HTMLElement {};
  }
  if (!g.customElements) {
    const registry = new Map<string, any>();
    g.customElements = {
      get: (name: string) => registry.get(name),
      define: (name: string, ctor: any) => registry.set(name, ctor),
    };
  }
  if (!g.document) {
    g.document = {
      createTreeWalker: () => ({ nextNode: () => null }),
      body: {},
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: noop,
      documentElement: { getAttribute: noop, setAttribute: noop, removeAttribute: noop, closest: noop },
      createComment: (text: string) => ({ textContent: text }),
      createTextNode: (text: string) => ({ textContent: text }),
    };
  }
  // Patch missing document properties (SSR DOM shim may not include all of them)
  if (g.document && !g.document.documentElement) {
    g.document.documentElement = { getAttribute: noop, setAttribute: noop, removeAttribute: noop, closest: noop };
  }
  if (g.document?.documentElement && !g.document.documentElement.getAttribute) {
    g.document.documentElement.getAttribute = noop;
  }
  if (!g.window) {
    g.window = g;
  }
  if (!g.window.matchMedia) {
    g.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  }
  if (!g.CSSStyleSheet) {
    g.CSSStyleSheet = class CSSStyleSheet {};
  }
  if (!g.MutationObserver) {
    g.MutationObserver = class MutationObserver { observe() {} disconnect() {} };
  }
  if (g.HTMLElement && !g.HTMLElement.prototype.closest) {
    g.HTMLElement.prototype.closest = noop;
  }
  if (g.HTMLElement && !g.HTMLElement.prototype.querySelector) {
    g.HTMLElement.prototype.querySelector = noop;
  }
  if (g.HTMLElement && !g.HTMLElement.prototype.querySelectorAll) {
    g.HTMLElement.prototype.querySelectorAll = () => [];
  }
}

function serveStaticFile(clientDir: string, pathname: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  // Prevent directory traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(clientDir, safePath);

  if (!filePath.startsWith(clientDir)) {
    return false;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const cacheControl = pathname.includes('/assets/') && /\.[a-f0-9]{8,}\./.test(pathname)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600';

  const content = fs.readFileSync(filePath);

  if (acceptsGzip(req) && isCompressible(contentType) && content.length > 1024) {
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
    const gzip = createGzip();
    pipeline(gzip, res, () => {});
    gzip.end(content);
  } else {
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
    res.end(content);
  }
  return true;
}

async function handleApiRoute(
  manifest: BuildManifest,
  serverDir: string,
  pathname: string,
  queryString: string | undefined,
  method: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const matched = matchRoute(manifest.apiRoutes, pathname);

  if (!matched) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API route not found' }));
    return;
  }

  const modulePath = path.join(serverDir, matched.route.module);
  if (!fs.existsSync(modulePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API route module not found' }));
    return;
  }

  const mod = await import(modulePath);
  const handler = mod[method];

  if (!handler || typeof handler !== 'function') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `Method ${method} not allowed` }));
    return;
  }

  // Parse query
  const query: Record<string, string> = {};
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, val] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }
  }

  // Parse body for non-GET methods
  let body: any = undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await readBody(req);
  }

  try {
    const result = await handler({
      method,
      url: pathname,
      query,
      params: matched.params,
      body,
      headers: req.headers,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (err: any) {
    const status = err?.status || 500;
    const message = err?.message || 'Internal server error';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleLoaderRequest(
  manifest: BuildManifest,
  serverDir: string,
  pagesDir: string,
  pathname: string,
  queryString: string | undefined,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse
): Promise<void> {
  const pagePath = pathname.replace('/__nk_loader', '') || '/';

  // Parse query params
  const query: Record<string, string> = {};
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, val] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }
  }

  let params: Record<string, string> = {};
  if (query.__params) {
    try { params = JSON.parse(query.__params); } catch { /* ignore */ }
    delete query.__params;
  }

  // Find the matching route with a loader
  const matched = matchRoute(manifest.routes.filter(r => r.hasLoader), pagePath);
  if (!matched || !matched.route.module) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ __nk_no_loader: true }));
    return;
  }

  const modulePath = path.join(serverDir, matched.route.module);
  if (!fs.existsSync(modulePath)) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ __nk_no_loader: true }));
    return;
  }

  try {
    const mod = await import(modulePath);
    if (!mod.loader || typeof mod.loader !== 'function') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ __nk_no_loader: true }));
      return;
    }

    const result = await mod.loader({ params: matched.params, query, url: pagePath, headers });
    if (isRedirectResponse(result)) {
      res.writeHead(result.status || 302, { Location: result.location });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result ?? null));
  } catch (err: any) {
    if (isRedirectResponse(err)) {
      res.writeHead(err.status || 302, { Location: err.location });
      res.end();
      return;
    }
    console.error(`[LumenJS] Loader error for ${pagePath}:`, err);
    const status = err?.status || 500;
    const message = err?.message || 'Loader failed';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handlePageRoute(
  manifest: BuildManifest,
  serverDir: string,
  pagesDir: string,
  pathname: string,
  queryString: string | undefined,
  indexHtmlShell: string,
  title: string,
  ssrRuntime: { render: any; html: any; unsafeStatic: any } | null,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Try SSR for routes with loaders
  const matched = matchRoute(manifest.routes.filter(r => r.hasLoader), pathname);

  if (matched && matched.route.module) {
    const modulePath = path.join(serverDir, matched.route.module);
    if (fs.existsSync(modulePath)) {
      try {
        const mod = await import(modulePath);

        // Run loader
        let loaderData: any = undefined;
        if (mod.loader && typeof mod.loader === 'function') {
          loaderData = await mod.loader({ params: matched.params, query: {}, url: pathname, headers: req.headers });
          if (isRedirectResponse(loaderData)) {
            res.writeHead(loaderData.status || 302, { Location: loaderData.location });
            res.end();
            return;
          }
        }

        // Find tag name from module
        const tagName = findTagName(mod);

        if (tagName && ssrRuntime) {
          // SSR render with the bundled @lit-labs/ssr runtime
          try {
            const { render, html, unsafeStatic } = ssrRuntime;

            const tag = unsafeStatic(tagName);
            const templateResult = html`<${tag} .loaderData=${loaderData}></${tag}>`;
            const ssrResult = render(templateResult);

            let ssrHtml = '';
            for (const chunk of ssrResult) {
              ssrHtml += typeof chunk === 'string' ? chunk : String(chunk);
            }

            // Inject SSR content + loader data into the shell
            const loaderDataScript = loaderData !== undefined
              ? `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(loaderData).replace(/</g, '\\u003c')}</script>`
              : '';
            const hydrateScript = `<script type="module">import '@lit-labs/ssr-client/lit-element-hydrate-support.js';</script>`;

            let html_out = indexHtmlShell;
            // Replace the <nk-app> tag with SSR content
            html_out = html_out.replace(
              /<nk-app><\/nk-app>/,
              `${loaderDataScript}<nk-app data-nk-ssr><div id="nk-router-outlet">${ssrHtml}</div></nk-app>${hydrateScript}`
            );

            sendCompressed(req, res, 200, 'text/html; charset=utf-8', html_out);
            return;
          } catch (ssrErr) {
            console.error('[LumenJS] SSR render failed, falling back to CSR:', ssrErr);
          }
        }

        // Fallback: inject loader data without SSR HTML
        if (loaderData !== undefined) {
          const loaderDataScript = `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(loaderData).replace(/</g, '\\u003c')}</script>`;
          let html_out = indexHtmlShell.replace('<nk-app>', `${loaderDataScript}<nk-app>`);
          sendCompressed(req, res, 200, 'text/html; charset=utf-8', html_out);
          return;
        }
      } catch (err) {
        console.error('[LumenJS] Page handler error:', err);
      }
    }
  }

  // SPA fallback — serve the built index.html
  sendCompressed(req, res, 200, 'text/html; charset=utf-8', indexHtmlShell);
}

function findTagName(mod: Record<string, any>): string | null {
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (typeof val === 'function' && val.prototype) {
      if (val.is) return val.is;
      if (val.elementProperties || val.properties) {
        const className = val.name || key;
        const tag = className
          .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
          .toLowerCase();
        if (tag.includes('-')) return tag;
      }
    }
  }
  return null;
}

interface MatchResult {
  route: ManifestRoute;
  params: Record<string, string>;
}

function matchRoute(routes: ManifestRoute[], pathname: string): MatchResult | null {
  const urlSegments = pathname.replace(/^\//, '').split('/').filter(Boolean);

  for (const route of routes) {
    const routeSegments = route.path.replace(/^\//, '').split('/').filter(Boolean);

    // Handle root route
    if (route.path === '/' && (pathname === '/' || pathname === '')) {
      return { route, params: {} };
    }

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < routeSegments.length; i++) {
      const seg = routeSegments[i];
      if (seg.startsWith(':...')) {
        // Catch-all: capture remaining URL segments
        if (i < urlSegments.length) {
          params[seg.slice(4)] = urlSegments.slice(i).join('/');
        } else {
          match = false;
        }
        break;
      } else if (seg.startsWith(':')) {
        if (i >= urlSegments.length) { match = false; break; }
        params[seg.slice(1)] = urlSegments[i];
      } else if (i >= urlSegments.length || seg !== urlSegments[i]) {
        match = false;
        break;
      }
      // For non-catch-all routes, lengths must match
      if (i === routeSegments.length - 1 && routeSegments.length !== urlSegments.length) {
        match = false;
      }
    }

    if (match) {
      return { route, params };
    }
  }

  return null;
}

function isRedirectResponse(value: any): value is { location: string; status?: number } {
  return value && typeof value === 'object' && typeof value.location === 'string' && value.__nk_redirect === true;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(data);
      }
    });
    req.on('error', reject);
  });
}

const COMPRESSIBLE_TYPES = new Set([
  'text/html', 'text/css', 'text/plain', 'text/xml',
  'application/javascript', 'application/json', 'application/xml',
  'application/manifest+json', 'image/svg+xml',
]);

function isCompressible(contentType: string): boolean {
  const base = contentType.split(';')[0].trim();
  return COMPRESSIBLE_TYPES.has(base);
}

function acceptsGzip(req: http.IncomingMessage): boolean {
  const ae = req.headers['accept-encoding'];
  return typeof ae === 'string' && ae.includes('gzip');
}

function sendCompressed(req: http.IncomingMessage, res: http.ServerResponse, statusCode: number, contentType: string, body: string | Buffer): void {
  if (acceptsGzip(req) && isCompressible(contentType) && Buffer.byteLength(body) > 1024) {
    res.writeHead(statusCode, { 'Content-Type': contentType, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
    const gzip = createGzip();
    pipeline(gzip, res, () => {});
    gzip.end(body);
  } else {
    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(body);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderErrorPage(status: number, title: string, message: string, detail?: string): string {
  const gradients: Record<number, string> = {
    404: 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)',
    500: 'linear-gradient(135deg, #ef4444, #f97316, #f59e0b)',
    502: 'linear-gradient(135deg, #f97316, #ef4444)',
    503: 'linear-gradient(135deg, #64748b, #475569)',
  };
  const gradient = gradients[status] || gradients[500];

  const detailBlock = detail
    ? `<div style="margin-top:1.5rem;padding:.75rem 1rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:left">
        <div style="font-size:.6875rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.375rem">Details</div>
        <pre style="margin:0;font-size:.75rem;color:#64748b;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(detail)}</pre>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${status} — ${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fafbfc;
      padding: 2rem;
    }
    .container { text-align: center; max-width: 440px; }
    .status {
      font-size: 5rem;
      font-weight: 200;
      letter-spacing: -2px;
      line-height: 1;
      color: #cbd5e1;
      user-select: none;
    }
    h1 { font-size: 1rem; font-weight: 500; color: #334155; margin: 1.25rem 0 .5rem; }
    .message { color: #94a3b8; font-size: .8125rem; line-height: 1.5; margin-bottom: 2rem; }
    .btn {
      display: inline-flex; align-items: center; gap: .375rem;
      padding: .4375rem 1rem;
      background: #f8fafc; color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 6px; font-size: .8125rem; font-weight: 400;
      text-decoration: none; transition: all .15s;
      cursor: pointer;
    }
    .btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
    .btn svg { flex-shrink: 0; }
    .divider { width: 32px; height: 2px; background: #e2e8f0; border-radius: 1px; margin: 1.25rem auto; }
    .footer { margin-top: 3rem; font-size: .6875rem; color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="status">${status}</div>
    <div class="divider"></div>
    <h1>${escapeHtml(title)}</h1>
    <p class="message">${escapeHtml(message)}</p>
    <a href="/" class="btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      Back to home
    </a>
    ${detailBlock}
    <div class="footer">LumenJS</div>
  </div>
</body>
</html>`;
}
