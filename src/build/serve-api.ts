import http from 'http';
import fs from 'fs';
import path from 'path';
import type { BuildManifest } from '../shared/types.js';
import { readBody } from '../shared/utils.js';
import { matchRoute } from '../shared/route-matching.js';
import { useStorage } from '../storage/index.js';

export async function handleApiRoute(
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
      storage: useStorage(),
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (err: any) {
    const status = err?.status || 500;
    // Only expose error messages for client errors (4xx); hide internals for 5xx
    const message = status < 500 ? (err?.message || 'Request error') : 'Internal server error';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}
