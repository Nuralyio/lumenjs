import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { editorApiPlugin } from './vite-plugin-editor-api.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';

// Helpers to create mock req/res
function createReq(method: string, url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  // Emit body data asynchronously
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  }
  return req;
}

function createRes(): ServerResponse & { _status: number; _headers: Record<string, string>; _body: string } {
  const res = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    setHeader(key: string, value: string) {
      res._headers[key] = value;
      return res;
    },
    end(data?: string) {
      if (data) res._body = data;
    },
  } as any;
  return res;
}

describe('editorApiPlugin', () => {
  let tmpDir: string;
  let middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-editor-api-'));
    // Set up some test files
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/index.ts'), 'export default {};');
    fs.writeFileSync(path.join(tmpDir, 'lumenjs.config.ts'), 'export default {};');

    const plugin = editorApiPlugin(tmpDir);
    // Extract the middleware from configureServer
    const fakeServer = { middlewares: { use: (fn: any) => { middleware = fn; } } };
    (plugin.configureServer as any)(fakeServer);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function invoke(method: string, url: string, body?: string): Promise<ReturnType<typeof createRes>> {
    return new Promise((resolve) => {
      const req = createReq(method, url, body);
      const res = createRes();
      const next = () => { res._status = -1; resolve(res); };
      middleware(req, res, next);
      // For GET requests without body, need to resolve after middleware processes
      if (body === undefined) {
        setTimeout(() => resolve(res), 50);
      } else {
        setTimeout(() => resolve(res), 50);
      }
    });
  }

  it('passes through non-editor URLs', async () => {
    const res = await invoke('GET', '/api/users');
    expect(res._status).toBe(-1); // next() was called
  });

  it('passes through URLs without matching prefix', async () => {
    const res = await invoke('GET', '/other');
    expect(res._status).toBe(-1);
  });

  describe('GET /__nk_editor/files', () => {
    it('lists project files', async () => {
      const res = await invoke('GET', '/__nk_editor/files');
      expect(res._status).toBe(200);
      const data = JSON.parse(res._body);
      expect(data.files).toContain('pages/index.ts');
      expect(data.files).toContain('lumenjs.config.ts');
    });
  });

  describe('GET /__nk_editor/files/<path>', () => {
    it('reads file content', async () => {
      const res = await invoke('GET', '/__nk_editor/files/pages/index.ts');
      expect(res._status).toBe(200);
      const data = JSON.parse(res._body);
      expect(data.content).toBe('export default {};');
    });

    it('returns 500 for non-existent file', async () => {
      const res = await invoke('GET', '/__nk_editor/files/missing.ts');
      expect(res._status).toBe(500);
    });

    it('returns 403 for path traversal', async () => {
      const res = await invoke('GET', '/__nk_editor/files/..%2F..%2Fetc%2Fpasswd');
      expect(res._status).toBe(403);
      const data = JSON.parse(res._body);
      expect(data.error).toBe('Path traversal detected');
    });
  });

  describe('PUT /__nk_editor/files/<path>', () => {
    it('writes file content', async () => {
      const res = await invoke('PUT', '/__nk_editor/files/pages/new.ts', JSON.stringify({ content: 'new code' }));
      expect(res._status).toBe(204);
      expect(fs.readFileSync(path.join(tmpDir, 'pages/new.ts'), 'utf-8')).toBe('new code');
    });

    it('creates directories as needed', async () => {
      const res = await invoke('PUT', '/__nk_editor/files/components/button.ts', JSON.stringify({ content: 'btn' }));
      expect(res._status).toBe(204);
      expect(fs.readFileSync(path.join(tmpDir, 'components/button.ts'), 'utf-8')).toBe('btn');
    });
  });

  describe('404 for unknown editor routes', () => {
    it('returns 404 for unknown path', async () => {
      const res = await invoke('GET', '/__nk_editor/unknown');
      expect(res._status).toBe(404);
    });
  });
});
