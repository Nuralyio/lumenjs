import http from 'http';
import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

const COMPRESSIBLE_TYPES = new Set([
  'text/html', 'text/css', 'text/plain', 'text/xml',
  'application/javascript', 'application/json', 'application/xml',
  'application/manifest+json', 'image/svg+xml',
]);

export function isCompressible(contentType: string): boolean {
  const base = contentType.split(';')[0].trim();
  return COMPRESSIBLE_TYPES.has(base);
}

export function acceptsGzip(req: http.IncomingMessage): boolean {
  const ae = req.headers['accept-encoding'];
  return typeof ae === 'string' && ae.includes('gzip');
}

export function sendCompressed(req: http.IncomingMessage, res: http.ServerResponse, statusCode: number, contentType: string, body: string | Buffer): void {
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

export function serveStaticFile(clientDir: string, pathname: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  // Prevent directory traversal
  const resolvedClientDir = path.resolve(clientDir);
  const filePath = path.resolve(resolvedClientDir, pathname.replace(/^\/+/, ''));

  if (!filePath.startsWith(resolvedClientDir + path.sep) && filePath !== resolvedClientDir) {
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
