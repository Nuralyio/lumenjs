import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadUserServerMiddleware } from './user-server-middleware.js';

describe('loadUserServerMiddleware', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenjs-server-mw-'));
    // Mark as ESM so `.js` is treated as ES module by Node's dynamic import
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('returns empty array when no lumenjs.server.js exists', async () => {
    const result = await loadUserServerMiddleware(tmpDir);
    expect(result).toEqual([]);
  });

  it('loads middleware array from lumenjs.server.js default export', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.server.js'),
      `export default [
        (req, res, next) => { req.mw1 = true; next(); },
        (req, res, next) => { req.mw2 = true; next(); },
      ];`
    );
    const result = await loadUserServerMiddleware(tmpDir);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('function');
  });

  it('loads a single middleware function as default export', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.server.js'),
      `export default (req, res, next) => { req.mw = true; next(); };`
    );
    const result = await loadUserServerMiddleware(tmpDir);
    expect(result).toHaveLength(1);
  });

  it('prefers lumenjs.server.js over lumenjs.server.mjs', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.server.js'),
      `export default [(req, res, next) => { req.source = 'js'; next(); }];`
    );
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.server.mjs'),
      `export default [(req, res, next) => { req.source = 'mjs'; next(); }];`
    );
    const result = await loadUserServerMiddleware(tmpDir);
    expect(result).toHaveLength(1);
    const req: any = {};
    result[0](req, {}, () => {});
    expect(req.source).toBe('js');
  });

  it('falls back to lumenjs.server.mjs when .js is absent', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.server.mjs'),
      `export default [(req, res, next) => { req.source = 'mjs'; next(); }];`
    );
    const result = await loadUserServerMiddleware(tmpDir);
    expect(result).toHaveLength(1);
  });

  it('returns empty array and warns on malformed module', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.server.js'),
      `this is not valid javascript {{{`
    );
    const result = await loadUserServerMiddleware(tmpDir);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
