import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Plugin } from 'vite';
import { setProjectDir } from '../../db/context.js';
import { useDb } from '../../db/index.js';
import { ensureCommunicationTables } from '../../communication/schema.js';
import { createCommunicationApiHandlers } from '../../communication/server.js';
import { fetchLinkPreview, extractUrls } from '../../communication/link-preview.js';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vite dev plugin for the communication module.
 * Initializes DB tables and provides REST API endpoints for conversations/messages.
 */
export function communicationPlugin(projectDir: string): Plugin {
  let db: any = null;
  let api: ReturnType<typeof createCommunicationApiHandlers> | null = null;

  function getApi() {
    if (api) return api;
    try {
      setProjectDir(projectDir);
      db = useDb();
      ensureCommunicationTables(db);
      api = createCommunicationApiHandlers(db);
      console.log('[LumenJS] Communication module initialized');
    } catch (err) {
      console.warn('[LumenJS Communication] DB init failed:', (err as any)?.message);
    }
    return api;
  }

  const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

  function readBody(req: IncomingMessage, maxSize: number = MAX_BODY_SIZE): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxSize) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  function sendJson(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  return {
    name: 'lumenjs-communication',
    configureServer(server) {
      // REST API for conversations and messages
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/__nk_comm/')) return next();

        const commApi = getApi();
        if (!commApi) {
          sendJson(res, 500, { error: 'Communication module not available' });
          return;
        }

        const userId = (req as any).nkAuth?.user?.sub;
        const rest = url.split('?')[0].slice('/__nk_comm/'.length);

        try {
          // GET /__nk_comm/conversations
          if (rest === 'conversations' && req.method === 'GET') {
            if (!userId) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
            const data = commApi.getConversations(userId);
            sendJson(res, 200, data);
            return;
          }

          // POST /__nk_comm/conversations
          if (rest === 'conversations' && req.method === 'POST') {
            if (!userId) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
            const body = JSON.parse(await readBody(req));
            const conv = commApi.createConversation({ ...body, participantIds: [userId, ...(body.participantIds || [])] });
            sendJson(res, 201, conv);
            return;
          }

          // GET /__nk_comm/messages/<conversationId>
          if (rest.startsWith('messages/') && req.method === 'GET') {
            if (!userId) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
            const conversationId = rest.slice('messages/'.length);
            const data = commApi.getMessages(conversationId);
            sendJson(res, 200, data);
            return;
          }

          // GET /__nk_comm/search?q=...
          if (rest === 'search' && req.method === 'GET') {
            if (!userId) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
            const params = new URL(url, 'http://localhost').searchParams;
            const data = commApi.searchMessages(params.get('q') || '');
            sendJson(res, 200, data);
            return;
          }

          // POST /__nk_comm/upload — file upload
          if (rest === 'upload' && req.method === 'POST') {
            if (!userId) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
            const uploadDir = path.join(projectDir, 'data', 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
            const chunks: Buffer[] = [];
            let uploadSize = 0;
            req.on('data', (c: Buffer) => {
              uploadSize += c.length;
              if (uploadSize > MAX_UPLOAD_SIZE) {
                req.destroy();
                sendJson(res, 413, { error: 'File too large' });
                return;
              }
              chunks.push(c);
            });
            req.on('end', () => {
              if (uploadSize > MAX_UPLOAD_SIZE) return;
              const body = Buffer.concat(chunks);
              const id = crypto.randomUUID();
              const contentType = req.headers['content-type'] || '';

              // Simple raw upload (client sends encrypted blob or raw file)
              const ext = contentType.includes('image') ? '.bin' : '.bin';
              const filePath = path.join(uploadDir, `${id}${ext}`);
              fs.writeFileSync(filePath, body);

              const fileUrl = `/__nk_comm/files/${id}`;
              if (db) {
                db.run('INSERT INTO attachments (id, filename, mimetype, size, url, uploaded_by, encrypted) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  id, req.headers['x-filename'] || `file-${id}`, contentType, body.length, fileUrl, userId, req.headers['x-encrypted'] === '1' ? 1 : 0);
              }
              sendJson(res, 201, { id, url: fileUrl, size: body.length });
            });
            return;
          }

          // GET /__nk_comm/files/:id — serve uploaded file
          if (rest.startsWith('files/') && req.method === 'GET') {
            const fileId = rest.slice('files/'.length);
            // Validate fileId contains only safe characters (UUID format)
            if (!/^[a-zA-Z0-9._-]+$/.test(fileId)) { sendJson(res, 400, { error: 'Invalid file ID' }); return; }
            const uploadDir = path.join(projectDir, 'data', 'uploads');
            const filePath = path.resolve(uploadDir, `${fileId}.bin`);
            if (!filePath.startsWith(uploadDir + path.sep)) { sendJson(res, 400, { error: 'Invalid file ID' }); return; }
            if (!fs.existsSync(filePath)) { sendJson(res, 404, { error: 'File not found' }); return; }
            const stat = fs.statSync(filePath);
            let contentType = 'application/octet-stream';
            if (db) {
              const att = db.get('SELECT mimetype FROM attachments WHERE id = ?', fileId);
              if (att) contentType = (att as any).mimetype;
            }
            res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
            fs.createReadStream(filePath).pipe(res);
            return;
          }

          // POST /__nk_comm/link-preview — fetch link preview
          if (rest === 'link-preview' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const urls = extractUrls(body.text || '');
            const previews = [];
            for (const u of urls) {
              const preview = await fetchLinkPreview(u, db);
              if (preview) previews.push(preview);
            }
            sendJson(res, 200, { previews });
            return;
          }

          sendJson(res, 404, { error: 'Not found' });
        } catch (err) {
          sendJson(res, 500, { error: (err as any)?.message || 'Internal error' });
        }
      });
    },
  };
}
