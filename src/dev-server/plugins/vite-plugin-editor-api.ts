import { Plugin, ViteDevServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { EditorFileService } from '../../editor/file-service.js';
import { AstService } from '../../editor/ast-service.js';
import { AstModification } from '../../editor/ast-modification.js';
import type { IncomingMessage, ServerResponse } from 'http';

const EDITOR_PREFIX = '/__nk_editor/';

/**
 * Vite plugin exposing editor API endpoints (only active in editor mode).
 * Provides file CRUD and AST modification via /__nk_editor/* routes.
 *
 * Uses HMR-aware file writes: editor-initiated changes are tracked so the
 * handleHotUpdate hook can suppress full-page reloads and send a lightweight
 * custom HMR event instead (the visual change is already applied in the browser).
 */
export function editorApiPlugin(projectDir: string): Plugin {
  const fileService = new EditorFileService(projectDir);
  const astService = new AstService();
  let viteServer: ViteDevServer;

  // Files recently written by the editor — suppresses full reload on next HMR cycle
  const editorWrites = new Set<string>();

  // Per-file write lock to prevent race conditions
  const writeLocks = new Map<string, Promise<void>>();

  async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const prev = writeLocks.get(filePath) || Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>(r => { resolve = r; });
    writeLocks.set(filePath, next);
    try {
      await prev;
      return await fn();
    } finally {
      resolve!();
      if (writeLocks.get(filePath) === next) {
        writeLocks.delete(filePath);
      }
    }
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  function sendJson(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  function sendError(res: ServerResponse, status: number, message: string) {
    sendJson(res, status, { error: message });
  }

  return {
    name: 'lumenjs-editor-api',
    handleHotUpdate({ file, server: s }) {
      const abs = path.resolve(file);
      if (editorWrites.has(abs)) {
        editorWrites.delete(abs);
        // Send lightweight custom event instead of full reload
        s.ws.send({ type: 'custom', event: 'nk-editor-update', data: { file } });
        // Return empty array to prevent Vite from doing a full reload
        return [];
      }
    },
    configureServer(server) {
      viteServer = server;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith(EDITOR_PREFIX)) return next();

        const urlPath = req.url.split('?')[0];
        const rest = urlPath.slice(EDITOR_PREFIX.length);

        try {
          // GET /__nk_editor/files — list all files
          if (rest === 'files' && req.method === 'GET') {
            const files = fileService.listFiles();
            sendJson(res, 200, { files });
            return;
          }

          // GET /__nk_editor/files/<path> — read file
          if (rest.startsWith('files/') && req.method === 'GET') {
            const filePath = decodeURIComponent(rest.slice('files/'.length));
            const content = fileService.readFile(filePath);
            sendJson(res, 200, { content });
            return;
          }

          // PUT /__nk_editor/files/<path> — write file
          if (rest.startsWith('files/') && req.method === 'PUT') {
            const filePath = decodeURIComponent(rest.slice('files/'.length));
            const body = JSON.parse(await readBody(req));
            await withLock(filePath, async () => {
              // If hmr=full query param, skip HMR suppression so Vite does a normal reload
              const url = new URL(req.url!, `http://${req.headers.host}`);
              if (url.searchParams.get('hmr') !== 'full') {
                editorWrites.add(path.resolve(projectDir, filePath));
              }
              fileService.writeFile(filePath, body.content);
            });
            res.writeHead(204);
            res.end();
            return;
          }

          // POST /__nk_editor/i18n/<locale> — update translation
          if (rest.startsWith('i18n/') && req.method === 'POST') {
            const locale = decodeURIComponent(rest.slice('i18n/'.length));
            if (locale.includes('/') || locale.includes('..')) {
              sendError(res, 400, 'Invalid locale');
              return;
            }
            const body = JSON.parse(await readBody(req));
            const { key, value } = body;
            if (typeof key !== 'string' || typeof value !== 'string') {
              sendError(res, 400, 'Missing key or value');
              return;
            }
            const localeFile = path.join(projectDir, 'locales', `${locale}.json`);
            await withLock(localeFile, async () => {
              const localesDir = path.join(projectDir, 'locales');
              if (!fs.existsSync(localesDir)) {
                fs.mkdirSync(localesDir, { recursive: true });
              }
              let obj: Record<string, string> = {};
              if (fs.existsSync(localeFile)) {
                obj = JSON.parse(fs.readFileSync(localeFile, 'utf-8'));
              }
              obj[key] = value;
              fs.writeFileSync(localeFile, JSON.stringify(obj, null, 2) + '\n');
            });
            res.writeHead(204);
            res.end();
            return;
          }

          // POST /__nk_editor/make-translatable — convert static text to i18n
          if (rest === 'make-translatable' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const { sourceFile: srcFile, elementSelector, sourceLine, i18nKey, text, locales } = body;
            if (!srcFile || !i18nKey || !text || !Array.isArray(locales)) {
              sendError(res, 400, 'Missing required fields');
              return;
            }

            // Check for key collision in locale files and deduplicate
            let finalKey = i18nKey;
            const localesDir = path.join(projectDir, 'locales');
            if (fs.existsSync(localesDir)) {
              const firstLocaleFile = path.join(localesDir, `${locales[0]}.json`);
              if (fs.existsSync(firstLocaleFile)) {
                const existing = JSON.parse(fs.readFileSync(firstLocaleFile, 'utf-8'));
                let suffix = 1;
                let candidate = finalKey;
                while (existing[candidate] !== undefined) {
                  suffix++;
                  candidate = `${i18nKey}_${suffix}`;
                }
                finalKey = candidate;
              }
            }

            await withLock(srcFile, async () => {
              // Apply AST modification to source file
              const source = fileService.readFile(srcFile);
              const mod: AstModification = {
                type: 'makeTranslatable',
                elementSelector,
                sourceLine,
                i18nKey: finalKey,
              };
              const modified = await astService.applyModification(source, mod);
              editorWrites.add(path.resolve(projectDir, srcFile));
              fileService.writeFile(srcFile, modified);
            });

            // Write translation to all locale JSON files
            if (!fs.existsSync(localesDir)) {
              fs.mkdirSync(localesDir, { recursive: true });
            }
            for (const locale of locales) {
              const localeFile = path.join(localesDir, `${locale}.json`);
              await withLock(localeFile, async () => {
                let obj: Record<string, string> = {};
                if (fs.existsSync(localeFile)) {
                  obj = JSON.parse(fs.readFileSync(localeFile, 'utf-8'));
                }
                obj[finalKey] = text;
                fs.writeFileSync(localeFile, JSON.stringify(obj, null, 2) + '\n');
              });
            }

            sendJson(res, 200, { key: finalKey });
            return;
          }

          // POST /__nk_editor/ast/<path> — apply AST modification
          if (rest.startsWith('ast/') && req.method === 'POST') {
            const filePath = decodeURIComponent(rest.slice('ast/'.length));
            const mod: AstModification = JSON.parse(await readBody(req));
            const content = await withLock(filePath, async () => {
              const source = fileService.readFile(filePath);
              const modified = await astService.applyModification(source, mod);
              editorWrites.add(path.resolve(projectDir, filePath));
              fileService.writeFile(filePath, modified);
              return modified;
            });
            sendJson(res, 200, { content });
            return;
          }

          sendError(res, 404, 'Not found');
        } catch (err: any) {
          const message = err?.message || 'Internal server error';
          const status = message === 'Path traversal detected' ? 403 : 500;
          sendError(res, status, message);
        }
      });
    },
  };
}
