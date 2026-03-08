import http from 'http';
import fs from 'fs';
import path from 'path';
import type { BuildManifest } from '../shared/types.js';
import { isRedirectResponse } from '../shared/utils.js';
import { matchRoute } from '../shared/route-matching.js';

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

  const modulePath = path.join(serverDir, layout.module);
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

    const result = await mod.loader({ params: {}, query: {}, url: `/__layout/${dir}`, headers });
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
