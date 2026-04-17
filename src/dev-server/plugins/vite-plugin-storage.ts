import type { Plugin, ViteDevServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { LocalStorageAdapter } from '../../storage/adapters/local.js';
import { setStorage } from '../../storage/index.js';

/**
 * LumenJS storage plugin (dev mode).
 *
 * - Creates a LocalStorageAdapter pointing to `{projectDir}/uploads`
 * - Registers it as the global storage singleton (`useStorage()`)
 * - Serves uploaded files at `/uploads/*`
 * - Handles presigned PUT requests at `/__nk_storage/upload/:token`
 */
export function lumenStoragePlugin(projectDir: string): Plugin {
  const uploadDir = path.join(projectDir, 'uploads');
  const adapter = new LocalStorageAdapter({ uploadDir, publicPath: '/uploads' });

  // Register global singleton so API routes and communication handlers can use it
  setStorage(adapter);

  return {
    name: 'lumenjs-storage',

    configureServer(server: ViteDevServer) {
      // ── Presigned upload endpoint ──────────────────────────────
      // Client sends a PUT to /__nk_storage/upload/:token with the (possibly
      // encrypted) file body. The token was issued via adapter.presignPut().
      server.middlewares.use('/__nk_storage/upload', async (req, res, next) => {
        if (req.method !== 'PUT') return next();

        const token = req.url?.replace(/^\//, '').split('?')[0];
        if (!token) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'missing token' }));
          return;
        }

        const pending = adapter.consumeUpload(token);
        if (!pending) {
          res.statusCode = 410; // Gone — expired or unknown token
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'upload token expired or invalid' }));
          return;
        }

        // Read raw body with streaming size enforcement
        const MAX_UPLOAD = pending.maxSize || 50 * 1024 * 1024; // 50MB default cap
        const chunks: Buffer[] = [];
        let uploadSize = 0;
        let aborted = false;
        req.on('data', (c: Buffer) => {
          uploadSize += c.length;
          if (uploadSize > MAX_UPLOAD) {
            aborted = true;
            req.destroy();
            res.statusCode = 413;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'file_too_large', maxSize: MAX_UPLOAD, received: uploadSize }));
            return;
          }
          chunks.push(c);
        });
        await new Promise<void>((resolve, reject) => {
          req.on('end', resolve);
          req.on('error', reject);
        });
        if (aborted) return;
        const body = Buffer.concat(chunks);

        // Enforce maxSize if specified (redundant safety check)
        if (pending.maxSize && body.length > pending.maxSize) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: `file_too_large`,
            maxSize: pending.maxSize,
            received: body.length,
          }));
          return;
        }

        // Write to disk (validate path stays within uploadDir)
        const filePath = path.resolve(uploadDir, pending.key);
        if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'invalid storage key' }));
          return;
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, body);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          key: pending.key,
          url: adapter.publicUrl(pending.key),
          size: body.length,
        }));
      });

      // ── Static file serving ────────────────────────────────────
      // Serve files from uploadDir at /uploads/*
      server.middlewares.use('/uploads', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        const filePath = path.resolve(uploadDir, decodeURIComponent((req.url?.split('?')[0] ?? '/').replace(/^\/+/, '')));
        if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
          return next();
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          return next();
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
          '.pdf': 'application/pdf', '.json': 'application/json',
          '.txt': 'text/plain', '.bin': 'application/octet-stream',
        };
        const contentType = mimeTypes[ext] ?? 'application/octet-stream';

        const stat = fs.statSync(filePath);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'no-cache');

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}
