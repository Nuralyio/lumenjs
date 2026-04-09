import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { scanPages, scanLayouts, scanApiRoutes, getLayoutDirsForPage } from './scan.js';

let tmpDir: string;

function createTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-scan-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('scanPages', () => {
  it('returns empty array for non-existent dir', () => {
    expect(scanPages('/nonexistent')).toEqual([]);
  });

  it('discovers page files', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export class Page {}');
    fs.writeFileSync(path.join(dir, 'about.ts'), 'export class About {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(2);
    expect(pages.map(p => p.routePath).sort()).toEqual(['/', '/about']);
  });

  it('discovers nested pages', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'blog', 'index.ts'), 'export class Blog {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(1);
    expect(pages[0].routePath).toBe('/blog');
  });

  it('handles dynamic segments', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'blog', '[slug].ts'), 'export class Post {}');
    const pages = scanPages(dir);
    expect(pages[0].routePath).toBe('/blog/:slug');
  });

  it('skips files starting with _', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), 'export class Layout {}');
    fs.writeFileSync(path.join(dir, '_helper.ts'), 'export function x() {}');
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export class Page {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toBe('index');
  });

  it('detects hasLoader', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function loader() { return {}; }\nexport class Page {}');
    const pages = scanPages(dir);
    expect(pages[0].hasLoader).toBe(true);
  });

  it('detects no loader', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export class Page {}');
    const pages = scanPages(dir);
    expect(pages[0].hasLoader).toBe(false);
  });

  it('skips non-index files in folder routes (directory with index.ts)', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), 'export class Dashboard {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'chart-widget.ts'), 'export class ChartWidget {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'stats-card.ts'), 'export class StatsCard {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(1);
    expect(pages[0].routePath).toBe('/dashboard');
  });

  it('registers all files in folders without index.ts (backward compat)', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'getting-started.ts'), 'export class A {}');
    fs.writeFileSync(path.join(dir, 'docs', 'api-reference.ts'), 'export class B {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(2);
    expect(pages.map(p => p.routePath).sort()).toEqual(['/docs/api-reference', '/docs/getting-started']);
  });

  it('still recurses into subdirectories within folder routes', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard', 'settings'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), 'export class Dashboard {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'helper.ts'), 'export class Helper {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'settings', 'index.ts'), 'export class Settings {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(2);
    expect(pages.map(p => p.routePath).sort()).toEqual(['/dashboard', '/dashboard/settings']);
  });

  it('handles dynamic folder routes ([id]/index.ts)', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'users', '[id]'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'users', '[id]', 'index.ts'), 'export class UserDetail {}');
    fs.writeFileSync(path.join(dir, 'users', '[id]', 'avatar.ts'), 'export class Avatar {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(1);
    expect(pages[0].routePath).toBe('/users/:id');
  });

  it('detects hasSubscribe', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function subscribe({ push }) { return () => {}; }\nexport class Page {}');
    const pages = scanPages(dir);
    expect(pages[0].hasSubscribe).toBe(true);
  });

  it('detects no subscribe', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export class Page {}');
    const pages = scanPages(dir);
    expect(pages[0].hasSubscribe).toBe(false);
  });

  it('detects hasSocket for inline export', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function socket({ on, push }) {}\nexport class Page {}');
    const pages = scanPages(dir);
    expect(pages[0].hasSocket).toBe(true);
  });

  it('detects hasSocket via co-located _socket.ts for folder route', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'chat'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat', 'index.ts'), 'export class Chat {}');
    fs.writeFileSync(path.join(dir, 'chat', '_socket.ts'), 'export function socket({ on, push }) {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(1);
    expect(pages[0].routePath).toBe('/chat');
    expect(pages[0].hasSocket).toBe(true);
  });

  it('does not detect hasSocket from _socket.ts for flat (non-index) pages', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'about.ts'), 'export class About {}');
    fs.writeFileSync(path.join(dir, '_socket.ts'), 'export function socket({ on, push }) {}');
    const pages = scanPages(dir);
    expect(pages).toHaveLength(1);
    expect(pages[0].routePath).toBe('/about');
    expect(pages[0].hasSocket).toBe(false);
  });

  it('detects co-located _loader.ts for folder route', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), 'export class Dashboard {}');
    fs.writeFileSync(path.join(dir, 'dashboard', '_loader.ts'), 'export async function loader() { return {}; }');
    const pages = scanPages(dir);
    expect(pages[0].hasLoader).toBe(true);
  });
});

describe('scanLayouts', () => {
  it('returns empty array for non-existent dir', () => {
    expect(scanLayouts('/nonexistent')).toEqual([]);
  });

  it('discovers root layout', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), 'export class Layout {}');
    const layouts = scanLayouts(dir);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].dir).toBe('');
  });

  it('discovers nested layout', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', '_layout.ts'), 'export class Layout {}');
    const layouts = scanLayouts(dir);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].dir).toBe('dashboard');
  });
});

describe('scanApiRoutes', () => {
  it('returns empty array for non-existent dir', () => {
    expect(scanApiRoutes('/nonexistent')).toEqual([]);
  });

  it('discovers api route files', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'users.ts'), 'export async function GET() {}');
    const routes = scanApiRoutes(dir);
    expect(routes).toHaveLength(1);
    expect(routes[0].routePath).toBe('users');
  });

  it('handles dynamic API segments', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'users'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'users', '[id].ts'), 'export async function GET() {}');
    const routes = scanApiRoutes(dir);
    expect(routes[0].routePath).toBe('users/:id');
  });
});

describe('getLayoutDirsForPage', () => {
  it('returns empty for page with no layouts', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    const result = getLayoutDirsForPage(path.join(dir, 'index.ts'), dir, []);
    expect(result).toEqual([]);
  });

  it('includes root layout', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    const layouts = [{ dir: '', filePath: path.join(dir, '_layout.ts'), hasLoader: false }];
    const result = getLayoutDirsForPage(path.join(dir, 'index.ts'), dir, layouts);
    expect(result).toEqual(['']);
  });

  it('returns chain for nested page', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), '');
    const layouts = [
      { dir: '', filePath: path.join(dir, '_layout.ts'), hasLoader: false },
      { dir: 'dashboard', filePath: path.join(dir, 'dashboard', '_layout.ts'), hasLoader: false },
    ];
    const result = getLayoutDirsForPage(path.join(dir, 'dashboard', 'index.ts'), dir, layouts);
    expect(result).toEqual(['', 'dashboard']);
  });
});
