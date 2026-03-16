import http from 'http';
import fs from 'fs';
import path from 'path';
import type { BuildManifest } from '../shared/types.js';
import { isRedirectResponse } from '../shared/utils.js';
import { matchRoute } from '../shared/route-matching.js';

/** Resolve a module path, falling back to bracket-sanitized filename (Rollup replaces [] with _) */
function resolveModulePath(serverDir: string, moduleName: string): string {
  const p = path.join(serverDir, moduleName);
  if (fs.existsSync(p)) return p;
  return path.join(serverDir, moduleName.replace(/\[/g, '_').replace(/\]/g, '_'));
}

export async function handleLayoutLoaderRequest(
  manifest: BuildManifest,
  serverDir: string,
  queryString: string | undefined,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse
): Promise<void> {
  const query: Record<string, string> = {};
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, val] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }
  }

  const dir = query.__dir || '';

  // Find the layout in manifest
  const layout = (manifest.layouts || []).find(l => l.dir === dir);
  if (!layout || !layout.hasLoader || !layout.module) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ __nk_no_loader: true }));
    return;
  }

  const modulePath = resolveModulePath(serverDir, layout.module);
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

    // Parse locale from query for layout loader
    const locale = query.__locale;
    delete query.__locale;

    const result = await mod.loader({ params: {}, query: {}, url: `/__layout/${dir}`, headers, locale });
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
    console.error(`[LumenJS] Layout loader error for dir=${dir}:`, err);
    const status = err?.status || 500;
    const message = err?.message || 'Layout loader failed';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}

export async function handleLayoutSubscribeRequest(
  manifest: BuildManifest,
  serverDir: string,
  queryString: string | undefined,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse
): Promise<void> {
  const query: Record<string, string> = {};
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, val] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }
  }

  const dir = query.__dir || '';
  const layout = (manifest.layouts || []).find(l => l.dir === dir);
  if (!layout || !layout.hasSubscribe || !layout.module) {
    res.writeHead(204);
    res.end();
    return;
  }

  const modulePath = resolveModulePath(serverDir, layout.module);
  if (!fs.existsSync(modulePath)) {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const mod = await import(modulePath);
    if (!mod.subscribe || typeof mod.subscribe !== 'function') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const locale = query.__locale;
    const push = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = mod.subscribe({ params: {}, push, headers, locale });
    res.on('close', () => {
      if (typeof cleanup === 'function') cleanup();
    });
  } catch (err: any) {
    console.error(`[LumenJS] Layout subscribe error for dir=${dir}:`, err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  }
}

export async function handleSubscribeRequest(
  manifest: BuildManifest,
  serverDir: string,
  pagesDir: string,
  pathname: string,
  queryString: string | undefined,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse
): Promise<void> {
  const pagePath = pathname.replace('/__nk_subscribe', '') || '/';

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

  const matched = matchRoute(manifest.routes.filter(r => r.hasSubscribe), pagePath);
  if (!matched || !matched.route.module) {
    res.writeHead(204);
    res.end();
    return;
  }

  const modulePath = resolveModulePath(serverDir, matched.route.module);
  if (!fs.existsSync(modulePath)) {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const mod = await import(modulePath);
    if (!mod.subscribe || typeof mod.subscribe !== 'function') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const locale = query.__locale;
    const push = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = mod.subscribe({ params: matched.params, push, headers, locale });
    res.on('close', () => {
      if (typeof cleanup === 'function') cleanup();
    });
  } catch (err: any) {
    console.error(`[LumenJS] Subscribe error for ${pagePath}:`, err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  }
}

export async function handleLoaderRequest(
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

  const modulePath = resolveModulePath(serverDir, matched.route.module);
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

    const locale = query.__locale;
    delete query.__locale;

    const result = await mod.loader({ params: matched.params, query, url: pagePath, headers, locale });
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
