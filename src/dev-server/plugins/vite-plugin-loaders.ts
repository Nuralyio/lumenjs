import { Plugin, ViteDevServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { isRedirectResponse } from '../../shared/utils.js';
import { installDomShims } from '../../shared/dom-shims.js';

/**
 * LumenJS Server Loaders plugin.
 *
 * Pages can export a `loader()` function that runs on the server.
 * The router fetches the data before rendering the page.
 *
 * Usage in a page file:
 *
 *   export async function loader({ params, url }) {
 *     const data = await fetchFromDB(params.id);
 *     return { item: data, timestamp: Date.now() };
 *   }
 *
 *   @customElement('page-item')
 *   export class PageItem extends LitElement {
 *     @property({ type: Object }) loaderData = {};
 *     render() {
 *       return html`<h1>${this.loaderData.item?.name}</h1>`;
 *     }
 *   }
 *
 * The loader runs server-side via /__nk_loader/<page-path>
 * Layout loaders run via /__nk_loader/__layout/?__dir=<dir>
 * The router auto-fetches and passes the result as `loaderData` property.
 */
export function lumenLoadersPlugin(pagesDir: string): Plugin {
  return {
    name: 'lumenjs-loaders',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__nk_loader/')) {
          return next();
        }

        const [pathname, queryString] = req.url.split('?');

        // Parse query params
        const query: Record<string, string> = {};
        if (queryString) {
          for (const pair of queryString.split('&')) {
            const [key, val] = pair.split('=');
            query[decodeURIComponent(key)] = decodeURIComponent(val || '');
          }
        }

        // Handle layout loader requests: /__nk_loader/__layout/?__dir=<dir>
        if (pathname === '/__nk_loader/__layout/' || pathname === '/__nk_loader/__layout') {
          const dir = query.__dir || '';
          await handleLayoutLoader(server, pagesDir, dir, req, res);
          return;
        }

        const pagePath = pathname.replace('/__nk_loader', '') || '/';

        // Parse URL params passed as __params query
        let params: Record<string, string> = {};
        if (query.__params) {
          try {
            params = JSON.parse(query.__params);
          } catch { /* ignore */ }
          delete query.__params;
        }

        // Find the page file
        const filePath = resolvePageFile(pagesDir, pagePath);
        if (!filePath) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Page not found' }));
          return;
        }

        // Extract params from URL if not provided via __params query
        if (Object.keys(params).length === 0) {
          Object.assign(params, extractRouteParams(pagesDir, pagePath, filePath));
        }

        try {
          // Provide minimal DOM shims for SSR so Lit class definitions don't crash
          installDomShims();

          const mod = await server.ssrLoadModule(filePath);

          if (!mod.loader || typeof mod.loader !== 'function') {
            // No loader — return empty data
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ __nk_no_loader: true }));
            return;
          }

          // Extract locale from query if provided by the client router
          const locale = query.__locale;
          delete query.__locale;

          const result = await mod.loader({ params, query, url: pagePath, headers: req.headers, locale });

          if (isRedirectResponse(result)) {
            res.statusCode = result.status || 302;
            res.setHeader('Location', result.location);
            res.end();
            return;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result ?? null));
        } catch (err: any) {
          if (isRedirectResponse(err)) {
            res.statusCode = err.status || 302;
            res.setHeader('Location', err.location);
            res.end();
            return;
          }
          console.error(`[LumenJS] Loader error for ${pagePath}:`, err);
          const status = err?.status || 500;
          const message = err?.message || 'Loader failed';
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: message }));
        }
      });
    },

    /**
     * Strip the loader() export from client bundles.
     * Runs before esbuild (enforce: 'pre') so we operate on raw TypeScript source.
     * Skip for SSR so ssrLoadModule can access the loader.
     * Applies to both page files and _layout files.
     */
    enforce: 'pre' as const,
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return;
      // Apply to page files and layout files within the pages directory
      if (!id.startsWith(pagesDir) || !id.endsWith('.ts')) return;
      if (!code.includes('export') || !code.includes('loader')) return;

      const hasLoader = /export\s+(async\s+)?function\s+loader\s*\(/.test(code);
      if (!hasLoader) return;

      // Find the loader function by tracking brace depth
      const match = code.match(/export\s+(async\s+)?function\s+loader\s*\(/);
      if (!match) return;

      const startIdx = match.index!;
      // Skip past the function signature's closing parenthesis (handles nested braces in type annotations)
      let parenDepth = 1;
      let sigIdx = startIdx + match[0].length;
      while (sigIdx < code.length && parenDepth > 0) {
        if (code[sigIdx] === '(') parenDepth++;
        else if (code[sigIdx] === ')') parenDepth--;
        sigIdx++;
      }
      // Find the opening brace of the function body (after the closing paren and optional return type)
      let braceStart = code.indexOf('{', sigIdx);
      if (braceStart === -1) return;

      let depth = 1;
      let i = braceStart + 1;
      while (i < code.length && depth > 0) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
        i++;
      }

      // Replace the entire loader function
      const transformed = code.substring(0, startIdx)
        + '// loader() — runs server-side only'
        + code.substring(i);

      const withFlag = transformed + '\nexport const __nk_has_loader = true;\n';
      return { code: withFlag, map: null };
    },
  };
}

/**
 * Handle layout loader requests.
 * GET /__nk_loader/__layout/?__dir=dashboard
 */
async function handleLayoutLoader(
  server: ViteDevServer,
  pagesDir: string,
  dir: string,
  req: any,
  res: any
): Promise<void> {
  // Resolve the layout file from the directory
  const layoutDir = path.join(pagesDir, dir);
  let layoutFile: string | null = null;

  for (const ext of ['.ts', '.js']) {
    const p = path.join(layoutDir, `_layout${ext}`);
    if (fs.existsSync(p)) {
      layoutFile = p;
      break;
    }
  }

  if (!layoutFile) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ __nk_no_loader: true }));
    return;
  }

  try {
    installDomShims();

    const mod = await server.ssrLoadModule(layoutFile);

    if (!mod.loader || typeof mod.loader !== 'function') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ __nk_no_loader: true }));
      return;
    }

    // Parse locale from query for layout loader requests
    const query: Record<string, string> = {};
    const reqUrl = req.url || '';
    const qs = reqUrl.split('?')[1];
    if (qs) {
      for (const pair of qs.split('&')) {
        const [key, val] = pair.split('=');
        query[decodeURIComponent(key)] = decodeURIComponent(val || '');
      }
    }
    const locale = query.__locale;

    const result = await mod.loader({ params: {}, query: {}, url: `/__layout/${dir}`, headers: req.headers, locale });

    if (isRedirectResponse(result)) {
      res.statusCode = result.status || 302;
      res.setHeader('Location', result.location);
      res.end();
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result ?? null));
  } catch (err: any) {
    if (isRedirectResponse(err)) {
      res.statusCode = err.status || 302;
      res.setHeader('Location', err.location);
      res.end();
      return;
    }
    console.error(`[LumenJS] Layout loader error for dir=${dir}:`, err);
    const status = err?.status || 500;
    const message = err?.message || 'Layout loader failed';
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: message }));
  }
}

/**
 * Map a URL path to a page file.
 * /         → pages/index.ts
 * /about    → pages/about.ts
 * /blog/foo → pages/blog/[slug].ts or pages/blog/foo.ts
 */
export function resolvePageFile(pagesDir: string, urlPath: string): string | null {
  const relative = urlPath.replace(/^\//, '') || 'index';
  const segments = relative.split('/');

  // Try exact match
  const exactPath = path.join(pagesDir, ...segments);
  for (const ext of ['.ts', '.js']) {
    if (fs.existsSync(exactPath + ext)) {
      return exactPath + ext;
    }
  }

  // Try index
  const indexPath = path.join(pagesDir, ...segments, 'index');
  for (const ext of ['.ts', '.js']) {
    if (fs.existsSync(indexPath + ext)) {
      return indexPath + ext;
    }
  }

  // Try dynamic segments
  return findDynamicPage(pagesDir, segments);
}

function findDynamicPage(baseDir: string, segments: string[]): string | null {
  if (segments.length === 0) return null;
  if (!fs.existsSync(baseDir)) return null;

  const [current, ...rest] = segments;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  if (rest.length === 0) {
    // Try exact or single-segment dynamic match first
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name.replace(/\.(ts|js)$/, '');
      if (name === current || (/^\[[^\.]/.test(name) && /^\[.+\]$/.test(name))) {
        return path.join(baseDir, entry.name);
      }
    }
    // Try catch-all [...name] file
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name.replace(/\.(ts|js)$/, '');
      if (/^\[\.\.\./.test(name)) {
        return path.join(baseDir, entry.name);
      }
    }
    return null;
  }

  // Try exact or single-segment dynamic directory match first
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === current || (/^\[[^\.]/.test(entry.name) && /^\[.+\]$/.test(entry.name))) {
      const result = findDynamicPage(path.join(baseDir, entry.name), rest);
      if (result) return result;
    }
  }

  // Try catch-all [...name] file (consumes all remaining segments)
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.replace(/\.(ts|js)$/, '');
    if (/^\[\.\.\./.test(name)) {
      return path.join(baseDir, entry.name);
    }
  }

  return null;
}

/**
 * Extract dynamic route params by comparing URL segments against [param] file path segments.
 */
export function extractRouteParams(pagesDir: string, urlPath: string, filePath: string): Record<string, string> {
  const params: Record<string, string> = {};
  const urlSegments = (urlPath.replace(/^\//, '') || 'index').split('/');
  const fileRelative = path.relative(pagesDir, filePath).replace(/\.(ts|js)$/, '');
  const fileSegments = fileRelative.split(path.sep);

  for (let i = 0; i < fileSegments.length && i < urlSegments.length; i++) {
    const catchAllMatch = fileSegments[i].match(/^\[\.\.\.(.+)\]$/);
    if (catchAllMatch) {
      // Catch-all: capture all remaining URL segments joined with /
      params[catchAllMatch[1]] = urlSegments.slice(i).join('/');
      break;
    }
    const match = fileSegments[i].match(/^\[(.+)\]$/);
    if (match) {
      params[match[1]] = urlSegments[i];
    }
  }

  return params;
}
