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
  escapeHtml,
  fileHasLoader,
  fileHasSubscribe,
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
  function createMockReq(data: string) {
    const { EventEmitter } = require('events');
    const emitter = new EventEmitter();
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

  it('returns false for non-existent file', () => {
    expect(fileHasSubscribe('/nonexistent/file.ts')).toBe(false);
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
