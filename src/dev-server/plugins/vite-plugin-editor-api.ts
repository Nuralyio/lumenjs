import { Plugin } from 'vite';
import { EditorFileService } from '../../editor/file-service.js';
import { AstService } from '../../editor/ast-service.js';
import { AstModification } from '../../editor/ast-modification.js';
import { streamAiChat, checkAiStatus, warmUpAiSession } from '../../editor/ai/backend.js';
import * as snapshotStore from '../../editor/ai/snapshot-store.js';
import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const EDITOR_PREFIX = '/__nk_editor/';

/**
 * Vite plugin exposing editor API endpoints (only active in editor mode).
 * Provides file CRUD and AST modification via /__nk_editor/* routes.
 */
export function editorApiPlugin(projectDir: string): Plugin {
  const fileService = new EditorFileService(projectDir);
  const astService = new AstService();

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
    configureServer(server) {
      // Warm up AI session in background so first request is fast
      warmUpAiSession(projectDir).catch(() => {});

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
              fileService.writeFile(filePath, body.content);
            });
            // Notify i18n HMR when a locale file is written
            const localeMatch = filePath.match(/^locales\/([a-z]{2}(?:-[a-zA-Z]+)?)\.json$/);
            if (localeMatch) {
              server.ws.send({
                type: 'custom',
                event: 'lumenjs:i18n-update',
                data: { locale: localeMatch[1] },
              });
            }
            res.writeHead(204);
            res.end();
            return;
          }

          // POST /__nk_editor/ast/<path> — apply AST modification
          if (rest.startsWith('ast/') && req.method === 'POST') {
            const filePath = decodeURIComponent(rest.slice('ast/'.length));
            const mod: AstModification = JSON.parse(await readBody(req));
            const content = await withLock(filePath, async () => {
              const source = fileService.readFile(filePath);
              const modified = await astService.applyModification(source, mod);
              fileService.writeFile(filePath, modified);
              return modified;
            });
            sendJson(res, 200, { content });
            return;
          }

          // GET /__nk_editor/ai/status — check if OpenCode is reachable
          if (rest === 'ai/status' && req.method === 'GET') {
            const status = await checkAiStatus();
            sendJson(res, 200, status);
            return;
          }

          // POST /__nk_editor/ai/chat — proxy to OpenCode with SSE streaming
          if (rest === 'ai/chat' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const { mode, prompt, context, sessionId, model } = body;

            if (!prompt) {
              sendError(res, 400, 'Missing prompt');
              return;
            }

            // Snapshot files before AI modifies them
            // For element mode, only snapshot the source file (much faster)
            // For project mode, snapshot all files
            const turnId = crypto.randomUUID();
            try {
              const fileContents = new Map<string, string>();
              if (mode === 'element' && context?.sourceFile) {
                try {
                  fileContents.set(context.sourceFile, fileService.readFile(context.sourceFile));
                } catch { /* skip */ }
              } else {
                const files = fileService.listFiles();
                for (const f of files) {
                  try {
                    fileContents.set(f, fileService.readFile(f));
                  } catch { /* skip */ }
                }
              }
              snapshotStore.save(turnId, fileContents);
            } catch {
              // Non-fatal — rollback just won't be available
            }

            // If element mode with a source file, read its content for richer context
            let enrichedContext = context || {};
            if (mode === 'element' && context?.sourceFile) {
              try {
                const fullContent = fileService.readFile(context.sourceFile);
                let sourceContent = fullContent;

                // Trim to ±20 lines around the target line to reduce token usage
                if (context.sourceLine && typeof context.sourceLine === 'number') {
                  const lines = fullContent.split('\n');
                  const start = Math.max(0, context.sourceLine - 20);
                  const end = Math.min(lines.length, context.sourceLine + 20);
                  const trimmed: string[] = [];
                  if (start > 0) trimmed.push(`// ... (lines 1-${start} omitted)`);
                  trimmed.push(...lines.slice(start, end));
                  if (end < lines.length) trimmed.push(`// ... (lines ${end + 1}-${lines.length} omitted)`);
                  sourceContent = trimmed.join('\n');
                }

                enrichedContext = { ...context, sourceContent };
              } catch {
                // File might not exist, continue without content
              }
            }

            // If project has i18n, include locale translations so the AI knows
            // to edit locale JSON files instead of hardcoding text in templates.
            const localesDir = path.join(projectDir, 'locales');
            if (fs.existsSync(localesDir)) {
              try {
                const localeFiles = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));
                const translations: Record<string, any> = {};
                for (const f of localeFiles) {
                  const locale = f.replace('.json', '');
                  translations[locale] = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf-8'));
                }
                enrichedContext = { ...enrichedContext, i18n: { translations } };
              } catch {
                // Non-fatal
              }
            }

            // Set up SSE response
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'X-Accel-Buffering': 'no',
            });

            const result = streamAiChat(projectDir, {
              mode: mode || 'project',
              prompt,
              context: enrichedContext,
              sessionId,
              model: model || 'default',
            });

            // Handle client disconnect
            req.on('close', () => result.abort());

            result.onToken((text) => {
              res.write(`event: token\ndata: ${JSON.stringify({ text })}\n\n`);
            });

            result.onDone((fullText) => {
              res.write(`event: done\ndata: ${JSON.stringify({ sessionId: result.sessionId, turnId, fullText })}\n\n`);
              res.end();
            });

            result.onError((err) => {
              res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
              res.end();
            });

            return;
          }

          // POST /__nk_editor/ai/rollback — restore file snapshots
          if (rest === 'ai/rollback' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const { turnId } = body;

            if (!turnId) {
              sendError(res, 400, 'Missing turnId');
              return;
            }

            const files = snapshotStore.restore(turnId);
            if (!files) {
              sendError(res, 404, 'Snapshot not found');
              return;
            }

            const restoredFiles: string[] = [];
            for (const [filePath, content] of files) {
              try {
                fileService.writeFile(filePath, content);
                restoredFiles.push(filePath);
              } catch {
                // Skip files that can't be written
              }
            }

            sendJson(res, 200, { restored: true, files: restoredFiles });
            return;
          }

          sendError(res, 404, 'Not found');
        } catch (err: any) {
          const message = err?.message || 'Internal server error';
          const status = message === 'Path traversal detected' ? 403 : 500;
          sendError(res, status, message);
        }
      });

      // Watch package.json for changes (e.g. after AI runs npm install).
      // When dependencies change, restart Vite to re-run dependency optimization.
      const pkgJsonPath = path.join(projectDir, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        let lastPkgDeps = readDepsHash(pkgJsonPath);

        const watcher = fs.watch(pkgJsonPath, { persistent: false }, () => {
          const currentDeps = readDepsHash(pkgJsonPath);
          if (currentDeps !== lastPkgDeps) {
            lastPkgDeps = currentDeps;
            console.log('[LumenJS] Dependencies changed — restarting dev server...');
            server.restart();
          }
        });

        server.httpServer?.on('close', () => watcher.close());
      }
    },
  };
}

/** Hash the dependencies/devDependencies from package.json to detect changes. */
function readDepsHash(pkgJsonPath: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const deps = JSON.stringify({
      d: pkg.dependencies || {},
      v: pkg.devDependencies || {},
    });
    return deps;
  } catch {
    return '';
  }
}
