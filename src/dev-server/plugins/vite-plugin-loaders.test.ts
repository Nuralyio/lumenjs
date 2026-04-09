import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolvePageFile, extractRouteParams, lumenLoadersPlugin } from './vite-plugin-loaders.js';

let tmpDir: string;

function createTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-loader-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolvePageFile', () => {
  it('resolves exact match', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'about.ts'), '');
    expect(resolvePageFile(dir, '/about')).toBe(path.join(dir, 'about.ts'));
  });

  it('resolves index file for /', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    expect(resolvePageFile(dir, '/')).toBe(path.join(dir, 'index.ts'));
  });

  it('resolves index file in subdirectory', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'blog', 'index.ts'), '');
    expect(resolvePageFile(dir, '/blog')).toBe(path.join(dir, 'blog', 'index.ts'));
  });

  it('resolves dynamic [param] file', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'blog', '[slug].ts'), '');
    const result = resolvePageFile(dir, '/blog/hello-world');
    expect(result).toBe(path.join(dir, 'blog', '[slug].ts'));
  });

  it('resolves catch-all [...param] file', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '[...path].ts'), '');
    const result = resolvePageFile(dir, '/docs/api/getting-started');
    expect(result).toBe(path.join(dir, 'docs', '[...path].ts'));
  });

  it('returns null for non-existent page', () => {
    const dir = createTmpDir();
    expect(resolvePageFile(dir, '/nonexistent')).toBeNull();
  });

  it('prefers exact match over dynamic', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'blog', 'featured.ts'), '');
    fs.writeFileSync(path.join(dir, 'blog', '[slug].ts'), '');
    const result = resolvePageFile(dir, '/blog/featured');
    expect(result).toBe(path.join(dir, 'blog', 'featured.ts'));
  });
});

describe('extractRouteParams', () => {
  it('extracts single dynamic param', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
    const filePath = path.join(dir, 'blog', '[slug].ts');
    fs.writeFileSync(filePath, '');
    const params = extractRouteParams(dir, '/blog/hello', filePath);
    expect(params).toEqual({ slug: 'hello' });
  });

  it('extracts catch-all param', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    const filePath = path.join(dir, 'docs', '[...path].ts');
    fs.writeFileSync(filePath, '');
    const params = extractRouteParams(dir, '/docs/api/routes', filePath);
    expect(params).toEqual({ path: 'api/routes' });
  });

  it('returns empty for static route', () => {
    const dir = createTmpDir();
    const filePath = path.join(dir, 'about.ts');
    fs.writeFileSync(filePath, '');
    const params = extractRouteParams(dir, '/about', filePath);
    expect(params).toEqual({});
  });
});

describe('lumenLoadersPlugin transform', () => {
  it('strips loader from client code', () => {
    const dir = createTmpDir();
    const plugin = lumenLoadersPlugin(dir);
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export function loader({ params }) {\n  return { name: 'test' };\n}\nexport class Page extends LitElement {}`;
    const result = transform(code, path.join(dir, 'index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).not.toContain('function loader');
    expect(result!.code).toContain('__nk_has_loader');
    expect(result!.code).toContain('loader() — runs server-side only');
  });

  it('strips async loader', () => {
    const dir = createTmpDir();
    const plugin = lumenLoadersPlugin(dir);
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export async function loader({ params }) {\n  const data = await fetch('/api');\n  return data;\n}\nexport class Page extends LitElement {}`;
    const result = transform(code, path.join(dir, 'index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).not.toContain('async function loader');
    expect(result!.code).toContain('__nk_has_loader');
  });

  it('skips SSR mode', () => {
    const dir = createTmpDir();
    const plugin = lumenLoadersPlugin(dir);
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export function loader() { return {}; }`;
    const result = transform(code, path.join(dir, 'index.ts'), { ssr: true });
    expect(result).toBeUndefined();
  });

  it('skips files without loader', () => {
    const dir = createTmpDir();
    const plugin = lumenLoadersPlugin(dir);
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export class Page extends LitElement {}`;
    const result = transform(code, path.join(dir, 'index.ts'));
    expect(result).toBeUndefined();
  });

  it('skips files outside pagesDir', () => {
    const dir = createTmpDir();
    const plugin = lumenLoadersPlugin(dir);
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export function loader() { return {}; }`;
    const result = transform(code, '/other/dir/file.ts');
    expect(result).toBeUndefined();
  });

  it('matches when Vite normalizes Windows backslashes to forward slashes', () => {
    // Simulate Windows: pagesDir has backslashes, but Vite normalizes id to forward slashes
    const plugin = lumenLoadersPlugin('C:\\project\\pages');
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export function loader({ params }) {\n  return { name: 'test' };\n}\nexport class Page extends LitElement {}`;
    const result = transform(code, 'C:/project/pages/index.ts');
    expect(result).toBeDefined();
    expect(result!.code).toContain('__nk_has_loader');
  });

  it('strips subscribe from client code', () => {
    const dir = createTmpDir();
    const plugin = lumenLoadersPlugin(dir);
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export function subscribe({ push }) {\n  const id = setInterval(() => push({ t: 1 }), 1000);\n  return () => clearInterval(id);\n}\nexport class Page extends LitElement {}`;
    const result = transform(code, path.join(dir, 'index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).not.toContain('function subscribe');
    expect(result!.code).toContain('__nk_has_subscribe');
    expect(result!.code).toContain('subscribe() — runs server-side only');
  });

  it('strips both loader and subscribe', () => {
    const dir = createTmpDir();
    const plugin = lumenLoadersPlugin(dir);
    const transform = plugin.transform as (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: null } | undefined;
    const code = `export function loader({ params }) {\n  return { x: 1 };\n}\nexport function subscribe({ push }) {\n  return () => {};\n}\nexport class Page extends LitElement {}`;
    const result = transform(code, path.join(dir, 'index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).not.toContain('function loader');
    expect(result!.code).not.toContain('function subscribe');
    expect(result!.code).toContain('__nk_has_loader');
    expect(result!.code).toContain('__nk_has_subscribe');
  });
});
