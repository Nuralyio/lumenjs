import http from 'http';
import fs from 'fs';
import path from 'path';
import type { BuildManifest } from '../shared/types.js';
import { isRedirectResponse } from '../shared/utils.js';
import { matchRoute } from '../shared/route-matching.js';
import { logger } from '../shared/logger.js';

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
  res: http.ServerResponse,
  user?: any,
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

    const result = await mod.loader({ params: {}, query: {}, url: `/__layout/${dir}`, headers, locale, user: user ?? null });
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
    logger.error(`Layout loader error`, { dir, error: (err as any)?.message });
    const status = err?.status || 500;
    const message = status < 500 ? (err?.message || 'Layout loader failed') : 'Internal server error';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}

export async function handleLayoutSubscribeRequest(
  manifest: BuildManifest,
  serverDir: string,
  queryString: string | undefined,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse,
  user?: any,
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
      if (res.destroyed || res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        console.error('[LumenJS] SSE push serialization error:', err);
      }
    };

    const cleanup = mod.subscribe({ params: {}, push, headers, locale, user: user ?? null });
    res.on('close', () => {
      if (typeof cleanup === 'function') cleanup();
    });
  } catch (err: any) {
    logger.error(`Layout subscribe error`, { dir, error: (err as any)?.message });
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  }
}

export async function handleComponentLoaderRequest(
  manifest: BuildManifest,
  serverDir: string,
  queryString: string | undefined,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse,
  user?: any,
): Promise<void> {
  const query: Record<string, string> = {};
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, val] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }
  }

  const file = query.__file || '';
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Missing __file parameter' }));
    return;
  }

  // Find the component in the manifest
  const comp = (manifest.components || []).find(c => c.file === file);
  if (!comp || !comp.module) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ __nk_no_loader: true }));
    return;
  }

  const modulePath = resolveModulePath(serverDir, comp.module);
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
    delete query.__file;

    const result = await mod.loader({ params: {}, query, url: `/__component/${file}`, headers, locale, user: user ?? null });
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
    logger.error(`Component loader error`, { file, error: (err as any)?.message });
    const status = err?.status || 500;
    const message = status < 500 ? (err?.message || 'Component loader failed') : 'Internal server error';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}

export async function handleSubscribeRequest(
  manifest: BuildManifest,
  serverDir: string,
  pagesDir: string,
  pathname: string,
  queryString: string | undefined,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse,
  user?: any,
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
    let subscribeFn: Function | null = mod.subscribe && typeof mod.subscribe === 'function' ? mod.subscribe : null;

    // Fallback: co-located _subscribe.js for folder index pages
    if (!subscribeFn && path.basename(modulePath, '.js') === 'index') {
      const colocated = path.join(path.dirname(modulePath), '_subscribe.js');
      if (fs.existsSync(colocated)) {
        const subMod = await import(colocated);
        if (subMod.subscribe && typeof subMod.subscribe === 'function') subscribeFn = subMod.subscribe;
      }
    }

    if (!subscribeFn) {
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
      if (res.destroyed || res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        console.error('[LumenJS] SSE push serialization error:', err);
      }
    };

    const cleanup = subscribeFn({ params: matched.params, push, headers, locale, user: user ?? null });
    res.on('close', () => {
      if (typeof cleanup === 'function') cleanup();
    });
  } catch (err: any) {
    logger.error(`Subscribe error`, { pagePath, error: (err as any)?.message });
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
  res: http.ServerResponse,
  user?: any,
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
    let loaderFn: Function | null = mod.loader && typeof mod.loader === 'function' ? mod.loader : null;

    // Fallback: co-located _loader.js for folder index pages
    if (!loaderFn && path.basename(modulePath, '.js') === 'index') {
      const colocated = path.join(path.dirname(modulePath), '_loader.js');
      if (fs.existsSync(colocated)) {
        const loaderMod = await import(colocated);
        if (loaderMod.loader && typeof loaderMod.loader === 'function') loaderFn = loaderMod.loader;
      }
    }

    if (!loaderFn) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ __nk_no_loader: true }));
      return;
    }

    const locale = query.__locale;
    delete query.__locale;

    const result = await loaderFn({ params: matched.params, query, url: pagePath, headers, locale, user: user ?? null });
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
    logger.error(`Loader error`, { pagePath, error: (err as any)?.message });
    const status = err?.status || 500;
    const message = status < 500 ? (err?.message || 'Loader failed') : 'Internal server error';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}
