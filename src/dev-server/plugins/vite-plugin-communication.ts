import path from 'path';
import { Plugin } from 'vite';
import { setProjectDir } from '../../db/context.js';
import { useDb } from '../../db/index.js';
import { ensureCommunicationTables } from '../../communication/schema.js';
import { createCommunicationApiHandlers } from '../../communication/server.js';
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

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
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
            const conversationId = rest.slice('messages/'.length);
            const data = commApi.getMessages(conversationId);
            sendJson(res, 200, data);
            return;
          }

          // GET /__nk_comm/search?q=...
          if (rest === 'search' && req.method === 'GET') {
            const params = new URL(url, 'http://localhost').searchParams;
            const data = commApi.searchMessages(params.get('q') || '');
            sendJson(res, 200, data);
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
