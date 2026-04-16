import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { lumenRoutesPlugin } from './vite-plugin-routes.js';

let tmpDir: string;

function createTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-routes-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('lumenRoutesPlugin', () => {
  it('resolves virtual module ID', () => {
    const dir = createTmpDir();
    const plugin = lumenRoutesPlugin(dir);
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    expect(resolveId('virtual:lumenjs-routes')).toBe('\0virtual:lumenjs-routes');
    expect(resolveId('other-module')).toBeUndefined();
  });

  it('generates route manifest for static pages', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export class Page extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'about.ts'), 'export class About extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes');

    expect(code).toBeDefined();
    expect(code).toContain('export const routes');
    expect(code).toContain('path: "/"');
    expect(code).toContain('path: "/about"');
    expect(code).toContain('tagName: "page-index"');
    expect(code).toContain('tagName: "page-about"');
  });

  it('discovers dynamic routes', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'blog', '[slug].ts'), 'export class Post extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('path: "/blog/:slug"');
  });

  it('sorts by per-segment specificity (matches server-side matcher)', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'about.ts'), 'export class A extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'docs', '[...path].ts'), 'export class B extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'docs', 'intro.ts'), 'export class C extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    const aboutIdx = code.indexOf('/about');
    const introIdx = code.indexOf('/docs/intro');
    const catchAllIdx = code.indexOf('/docs/:...path');
    // /docs/intro (score 4) is more specific than /about (score 2) and
    // /docs/:...path (score 2). Static still beats catch-all at equal score
    // via the alphabetical tie-break.
    expect(introIdx).toBeLessThan(aboutIdx);
    expect(aboutIdx).toBeLessThan(catchAllIdx);
  });

  it('sorts overlapping mixed routes the same way as the server matcher', () => {
    // Regression: see issue #1226. Previously the plugin used a coarse
    // 3-bucket sort (static → dynamic → catch-all) which placed /:x/y/:z
    // before /a/:b/c alphabetically, while the server matcher (per-segment
    // specificity) places /a/:b/c first. For the URL /a/y/c both routes
    // match, so the client and server would hydrate different pages.
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'a', '[b]'), { recursive: true });
    fs.mkdirSync(path.join(dir, '[x]', 'y'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a', '[b]', 'c.ts'), 'export class A extends LitElement {}');
    fs.writeFileSync(path.join(dir, '[x]', 'y', '[z].ts'), 'export class B extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    const abcIdx = code.indexOf('/a/:b/c');
    const xyzIdx = code.indexOf('/:x/y/:z');
    expect(abcIdx).toBeGreaterThanOrEqual(0);
    expect(xyzIdx).toBeGreaterThanOrEqual(0);
    // /a/:b/c → score 2+1+2=5, /:x/y/:z → score 1+2+1=4. /a/:b/c must come first.
    expect(abcIdx).toBeLessThan(xyzIdx);
  });

  it('discovers layouts and includes in route entries', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), 'export class RootLayout extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export class Page extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('layouts:');
    expect(code).toContain('tagName: "layout-root"');
  });

  it('returns empty routes for non-existent dir', () => {
    const plugin = lumenRoutesPlugin('/nonexistent');
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('export const routes = [\n\n]');
  });

  it('detects hasLoader in route manifest', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function loader() { return {}; }\nexport class Page extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('hasLoader: true');
  });

  it('detects hasSubscribe in route manifest', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function subscribe({ push }) { return () => {}; }\nexport class Page extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('hasSubscribe: true');
  });

  it('skips non-index files in folder routes (directory with index.ts)', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), 'export class Dashboard extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'chart-widget.ts'), 'export class ChartWidget extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'stats-card.ts'), 'export class StatsCard extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('path: "/dashboard"');
    expect(code).not.toContain('chart-widget');
    expect(code).not.toContain('stats-card');
  });

  it('registers all files in folders without index.ts (backward compat)', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'getting-started.ts'), 'export class A extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'docs', 'api-reference.ts'), 'export class B extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('path: "/docs/getting-started"');
    expect(code).toContain('path: "/docs/api-reference"');
  });

  it('still recurses into subdirectories within folder routes', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard', 'settings'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), 'export class Dashboard extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'helper.ts'), 'export class Helper extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'settings', 'index.ts'), 'export class Settings extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('path: "/dashboard"');
    expect(code).toContain('path: "/dashboard/settings"');
    expect(code).not.toContain('helper');
  });

  it('preserves _layout.ts in folder routes', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), 'export class Dashboard extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'dashboard', '_layout.ts'), 'export class Layout extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'dashboard', 'utils.ts'), 'export function helper() {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('path: "/dashboard"');
    expect(code).toContain('layouts:');
    expect(code).toContain('tagName: "layout-dashboard"');
    expect(code).not.toContain('utils');
  });

  it('handles dynamic folder routes ([id]/index.ts)', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'users', '[id]'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'users', '[id]', 'index.ts'), 'export class UserDetail extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'users', '[id]', 'avatar.ts'), 'export class Avatar extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('path: "/users/:id"');
    expect(code).not.toContain('avatar');
  });

  it('detects hasSubscribe on layout in route manifest', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), 'export function subscribe({ push }) { return () => {}; }\nexport class Layout extends LitElement {}');
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export class Page extends LitElement {}');

    const plugin = lumenRoutesPlugin(dir);
    const load = plugin.load as (id: string) => string | undefined;
    const code = load('\0virtual:lumenjs-routes')!;

    expect(code).toContain('hasSubscribe: true');
  });
});
