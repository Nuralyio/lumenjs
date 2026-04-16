import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  stripOuterLitMarkers,
  dirToLayoutTagName,
  findTagName,
  filePathToTagName,
  isRedirectResponse,
  readBody,
  unwrapResponse,
  loadEnvFile,
  escapeHtml,
  fileHasLoader,
  fileHasSubscribe,
  fileHasSocket,
  filePathToRoute,
} from './utils.js';

describe('stripOuterLitMarkers', () => {
  it('strips opening and closing lit-part markers', () => {
    const html = '<!--lit-part abc123--><div>hello</div><!--/lit-part-->';
    expect(stripOuterLitMarkers(html)).toBe('<div>hello</div>');
  });

  it('strips lit-node marker after lit-part', () => {
    const html = '<!--lit-part abc123--><!--lit-node 0--><div>hello</div><!--/lit-part-->';
    expect(stripOuterLitMarkers(html)).toBe('<div>hello</div>');
  });

  it('returns unchanged html without markers', () => {
    const html = '<div>hello</div>';
    expect(stripOuterLitMarkers(html)).toBe('<div>hello</div>');
  });

  it('handles empty string', () => {
    expect(stripOuterLitMarkers('')).toBe('');
  });
});

describe('dirToLayoutTagName', () => {
  it('returns layout-root for empty string', () => {
    expect(dirToLayoutTagName('')).toBe('layout-root');
  });

  it('converts simple directory', () => {
    expect(dirToLayoutTagName('dashboard')).toBe('layout-dashboard');
  });

  it('converts nested directory with slashes', () => {
    expect(dirToLayoutTagName('app/settings')).toBe('layout-app-settings');
  });

  it('strips dynamic segment brackets', () => {
    expect(dirToLayoutTagName('app/[id]')).toBe('layout-app-id');
  });

  it('strips catch-all brackets', () => {
    expect(dirToLayoutTagName('docs/[...slug]')).toBe('layout-docs-slug');
  });

  it('converts backslashes to dashes', () => {
    expect(dirToLayoutTagName('app\\settings')).toBe('layout-app-settings');
  });
});

describe('findTagName', () => {
  it('returns tag name from class with elementProperties', () => {
    class MyComponent { static elementProperties = new Map(); }
    const mod = { MyComponent };
    expect(findTagName(mod)).toBe('my-component');
  });

  it('returns tag name from class with static is', () => {
    class MyEl { static is = 'custom-tag'; static elementProperties = new Map(); }
    const mod = { MyEl };
    expect(findTagName(mod)).toBe('custom-tag');
  });

  it('returns null for module without components', () => {
    const mod = { helper: () => {} };
    expect(findTagName(mod)).toBeNull();
  });

  it('returns null for class name without dash', () => {
    class Button { static elementProperties = new Map(); }
    Object.defineProperty(Button, 'name', { value: 'Button' });
    const mod = { Button };
    expect(findTagName(mod)).toBeNull();
  });

  it('returns tag from properties getter', () => {
    class AppHeader { static properties = {}; }
    const mod = { AppHeader };
    expect(findTagName(mod)).toBe('app-header');
  });
});

describe('filePathToTagName', () => {
  it('converts index.ts', () => {
    expect(filePathToTagName('index.ts')).toBe('page-index');
  });

  it('converts nested path', () => {
    expect(filePathToTagName('docs/api-routes.ts')).toBe('page-docs-api-routes');
  });

  it('strips dynamic segment brackets', () => {
    expect(filePathToTagName('blog/[slug].ts')).toBe('page-blog-slug');
  });

  it('strips catch-all brackets', () => {
    expect(filePathToTagName('docs/[...path].ts')).toBe('page-docs-path');
  });

  it('handles .js extension', () => {
    expect(filePathToTagName('about.js')).toBe('page-about');
  });
});

describe('isRedirectResponse', () => {
  it('returns true for valid redirect', () => {
    expect(isRedirectResponse({ __nk_redirect: true, location: '/home', status: 302 })).toBe(true);
  });

  it('returns false for missing __nk_redirect', () => {
    expect(isRedirectResponse({ location: '/home' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRedirectResponse(null)).toBeFalsy();
  });

  it('returns false for string', () => {
    expect(isRedirectResponse('/home')).toBe(false);
  });

  it('returns false when location is not a string', () => {
    expect(isRedirectResponse({ __nk_redirect: true, location: 123 })).toBe(false);
  });
});

describe('readBody', () => {
  function createMockReq(data: string, headers: Record<string, string> = {}) {
    const { EventEmitter } = require('events');
    const emitter: any = new EventEmitter();
    emitter.headers = headers;
    setTimeout(() => {
      if (data) emitter.emit('data', Buffer.from(data));
      emitter.emit('end');
    }, 0);
    return emitter;
  }

  it('parses JSON body', async () => {
    const req = createMockReq('{"name":"test"}');
    const result = await readBody(req);
    expect(result).toEqual({ name: 'test' });
  });

  it('returns raw string for non-JSON', async () => {
    const req = createMockReq('hello world');
    const result = await readBody(req);
    expect(result).toBe('hello world');
  });

  it('returns undefined for empty body', async () => {
    const req = createMockReq('');
    const result = await readBody(req);
    expect(result).toBeUndefined();
  });

  it('rejects on error', async () => {
    const { EventEmitter } = require('events');
    const emitter = new EventEmitter();
    setTimeout(() => emitter.emit('error', new Error('fail')), 0);
    await expect(readBody(emitter)).rejects.toThrow('fail');
  });

  it('parses JSON with unescaped backslashes (Windows paths)', async () => {
    // {"path": "C:\Users\data"} — \U and \d are not valid JSON escapes
    const req = createMockReq('{"path": "C:\\Users\\data"}');
    const result = await readBody(req);
    expect(result).toEqual({ path: 'C:\\Users\\data' });
  });

  it('parses JSON with backslash-heavy Windows path', async () => {
    const req = createMockReq('{"dir": "C:\\Projects\\my-app\\src"}');
    const result = await readBody(req);
    expect(result).toEqual({ dir: 'C:\\Projects\\my-app\\src' });
  });

  it('parses application/x-www-form-urlencoded body into an object', async () => {
    const req = createMockReq('name=John&age=30', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    const result = await readBody(req);
    expect(result).toEqual({ name: 'John', age: '30' });
  });

  it('decodes url-encoded values in form bodies', async () => {
    const req = createMockReq('greeting=hello%20world&sign=%26', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    const result = await readBody(req);
    expect(result).toEqual({ greeting: 'hello world', sign: '&' });
  });

  it('respects content-type with charset parameter', async () => {
    const req = createMockReq('name=John', {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    });
    const result = await readBody(req);
    expect(result).toEqual({ name: 'John' });
  });
});

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes all at once', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('fileHasLoader', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for file with export function loader', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export function loader({ params }) { return {}; }');
    expect(fileHasLoader(file)).toBe(true);
  });

  it('returns true for async loader', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export async function loader({ params }) { return {}; }');
    expect(fileHasLoader(file)).toBe(true);
  });

  it('returns false for file without loader', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export class MyPage extends LitElement {}');
    expect(fileHasLoader(file)).toBe(false);
  });

  it('returns false for non-existent file', () => {
    expect(fileHasLoader('/nonexistent/file.ts')).toBe(false);
  });
});

describe('fileHasSubscribe', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for file with export function subscribe', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export function subscribe({ push }) { return () => {}; }');
    expect(fileHasSubscribe(file)).toBe(true);
  });

  it('returns true for async subscribe', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export async function subscribe({ push }) { return () => {}; }');
    expect(fileHasSubscribe(file)).toBe(true);
  });

  it('returns false for file without subscribe', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export class MyPage extends LitElement {}');
    expect(fileHasSubscribe(file)).toBe(false);
  });

  it('returns true for index.ts with sibling _subscribe.ts', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const indexFile = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(indexFile, 'export class Page extends LitElement {}');
    fs.writeFileSync(path.join(tmpDir, '_subscribe.ts'), 'export function subscribe({ push }) { return () => {}; }');
    expect(fileHasSubscribe(indexFile)).toBe(true);
  });

  it('returns true for index.ts with sibling _subscribe.js', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const indexFile = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(indexFile, 'export class Page extends LitElement {}');
    fs.writeFileSync(path.join(tmpDir, '_subscribe.js'), 'export function subscribe({ push }) {}');
    expect(fileHasSubscribe(indexFile)).toBe(true);
  });

  it('returns false for non-index file with sibling _subscribe.ts', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const pageFile = path.join(tmpDir, 'feed.ts');
    fs.writeFileSync(pageFile, 'export class Feed extends LitElement {}');
    fs.writeFileSync(path.join(tmpDir, '_subscribe.ts'), 'export function subscribe({ push }) {}');
    expect(fileHasSubscribe(pageFile)).toBe(false);
  });

  it('returns false for non-existent file', () => {
    expect(fileHasSubscribe('/nonexistent/file.ts')).toBe(false);
  });
});

describe('fileHasSocket', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for inline export function socket', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export function socket({ on, push }) {}\nexport class Page {}');
    expect(fileHasSocket(file)).toBe(true);
  });

  it('returns true for inline export const socket', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export const socket = ({ on }) => {};\nexport class Page {}');
    expect(fileHasSocket(file)).toBe(true);
  });

  it('returns false for file without socket export', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const file = path.join(tmpDir, 'page.ts');
    fs.writeFileSync(file, 'export class Page {}');
    expect(fileHasSocket(file)).toBe(false);
  });

  it('returns true for index.ts with sibling _socket.ts', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const indexFile = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(indexFile, 'export class Page {}');
    fs.writeFileSync(path.join(tmpDir, '_socket.ts'), 'export function socket({ on, push }) {}');
    expect(fileHasSocket(indexFile)).toBe(true);
  });

  it('returns true for index.ts with sibling _socket.js', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const indexFile = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(indexFile, 'export class Page {}');
    fs.writeFileSync(path.join(tmpDir, '_socket.js'), 'export function socket({ on, push }) {}');
    expect(fileHasSocket(indexFile)).toBe(true);
  });

  it('returns false for non-index file with sibling _socket.ts', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const pageFile = path.join(tmpDir, 'about.ts');
    fs.writeFileSync(pageFile, 'export class About {}');
    fs.writeFileSync(path.join(tmpDir, '_socket.ts'), 'export function socket({ on, push }) {}');
    expect(fileHasSocket(pageFile)).toBe(false);
  });

  it('returns false for index.ts with no inline socket and no _socket.ts', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    const indexFile = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(indexFile, 'export class Page {}');
    expect(fileHasSocket(indexFile)).toBe(false);
  });

  it('returns false for non-existent file', () => {
    expect(fileHasSocket('/nonexistent/file.ts')).toBe(false);
  });
});

describe('filePathToRoute', () => {
  it('converts index.ts to /', () => {
    expect(filePathToRoute('index.ts')).toBe('/');
  });

  it('converts about.ts to /about', () => {
    expect(filePathToRoute('about.ts')).toBe('/about');
  });

  it('converts nested index', () => {
    expect(filePathToRoute('blog/index.ts')).toBe('/blog');
  });

  it('converts dynamic segment', () => {
    expect(filePathToRoute('blog/[slug].ts')).toBe('/blog/:slug');
  });

  it('converts catch-all segment', () => {
    expect(filePathToRoute('docs/[...path].ts')).toBe('/docs/:...path');
  });

  it('handles deeply nested paths', () => {
    expect(filePathToRoute('app/settings/profile.ts')).toBe('/app/settings/profile');
  });

  it('handles .js extension', () => {
    expect(filePathToRoute('about.js')).toBe('/about');
  });
});

describe('unwrapResponse', () => {
  it('extracts JSON from a Response object', async () => {
    const response = Response.json({ users: ['Alice', 'Bob'] });
    const result = await unwrapResponse(response);
    expect(result).toEqual({ users: ['Alice', 'Bob'] });
  });

  it('passes through plain objects unchanged', async () => {
    const obj = { name: 'test' };
    const result = await unwrapResponse(obj);
    expect(result).toBe(obj);
  });

  it('passes through null/undefined', async () => {
    expect(await unwrapResponse(null)).toBeNull();
    expect(await unwrapResponse(undefined)).toBeUndefined();
  });

  it('passes through strings', async () => {
    expect(await unwrapResponse('hello')).toBe('hello');
  });

  it('returns null for Response with non-JSON body', async () => {
    const response = new Response('not json', { headers: { 'Content-Type': 'text/plain' } });
    // Response.json() will fail since body is not JSON
    // But our detection checks .json method existence, so it will try and catch
    // Actually Response has .json() method always, it just throws on non-JSON
    const result = await unwrapResponse(response);
    expect(result).toBeNull();
  });
});

describe('loadEnvFile', () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  function saveEnv(...keys: string[]) {
    for (const key of keys) savedEnv[key] = process.env[key];
  }

  it('loads variables from .env file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-env-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'TEST_LUMEN_A=hello\nTEST_LUMEN_B=world\n');
    saveEnv('TEST_LUMEN_A', 'TEST_LUMEN_B');
    delete process.env.TEST_LUMEN_A;
    delete process.env.TEST_LUMEN_B;

    loadEnvFile(tmpDir);
    expect(process.env.TEST_LUMEN_A).toBe('hello');
    expect(process.env.TEST_LUMEN_B).toBe('world');
  });

  it('does not override existing env vars', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-env-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'TEST_LUMEN_C=from_file\n');
    saveEnv('TEST_LUMEN_C');
    process.env.TEST_LUMEN_C = 'existing';

    loadEnvFile(tmpDir);
    expect(process.env.TEST_LUMEN_C).toBe('existing');
  });

  it('strips surrounding quotes', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-env-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'TEST_LUMEN_D="quoted value"\nTEST_LUMEN_E=\'single\'\n');
    saveEnv('TEST_LUMEN_D', 'TEST_LUMEN_E');
    delete process.env.TEST_LUMEN_D;
    delete process.env.TEST_LUMEN_E;

    loadEnvFile(tmpDir);
    expect(process.env.TEST_LUMEN_D).toBe('quoted value');
    expect(process.env.TEST_LUMEN_E).toBe('single');
  });

  it('skips comments and empty lines', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-env-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), '# comment\n\nTEST_LUMEN_F=ok\n');
    saveEnv('TEST_LUMEN_F');
    delete process.env.TEST_LUMEN_F;

    loadEnvFile(tmpDir);
    expect(process.env.TEST_LUMEN_F).toBe('ok');
  });

  it('does not crash if .env does not exist', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-env-'));
    expect(() => loadEnvFile(tmpDir)).not.toThrow();
  });
});
