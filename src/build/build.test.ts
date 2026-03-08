import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { scanPages, scanLayouts, scanApiRoutes, getLayoutDirsForPage } from './scan.js';
import { filePathToTagName } from '../shared/utils.js';
import type { BuildManifest } from '../shared/types.js';

let tmpDir: string;

function createTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-build-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Test the manifest generation logic extracted from buildProject().
 * We don't call buildProject() directly since it requires Vite, but we test
 * the manifest structure it would produce.
 */
function generateManifest(projectDir: string): BuildManifest {
  const pagesDir = path.join(projectDir, 'pages');
  const apiDir = path.join(projectDir, 'api');

  const pageEntries = scanPages(pagesDir);
  const layoutEntries = scanLayouts(pagesDir);
  const apiEntries = scanApiRoutes(apiDir);

  return {
    routes: pageEntries.map(e => {
      const routeLayouts = getLayoutDirsForPage(e.filePath, pagesDir, layoutEntries);
      const relPath = path.relative(pagesDir, e.filePath).replace(/\\/g, '/');
      return {
        path: e.routePath,
        module: e.hasLoader ? `pages/${e.name}.js` : '',
        hasLoader: e.hasLoader,
        tagName: filePathToTagName(relPath),
        ...(routeLayouts.length > 0 ? { layouts: routeLayouts } : {}),
      };
    }),
    apiRoutes: apiEntries.map(e => ({
      path: `/api/${e.routePath}`,
      module: `api/${e.name}.js`,
      hasLoader: false,
    })),
    layouts: layoutEntries.map(e => ({
      dir: e.dir,
      module: e.hasLoader ? (e.dir ? `layouts/${e.dir}/_layout.js` : 'layouts/_layout.js') : '',
      hasLoader: e.hasLoader,
    })),
  };
}

describe('build manifest generation', () => {
  it('generates manifest for simple project', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pages', 'index.ts'), 'export class Page {}');
    fs.writeFileSync(path.join(dir, 'pages', 'about.ts'), 'export class About {}');

    const manifest = generateManifest(dir);
    expect(manifest.routes).toHaveLength(2);
    expect(manifest.routes.map(r => r.path).sort()).toEqual(['/', '/about']);
    expect(manifest.routes.find(r => r.path === '/')!.tagName).toBe('page-index');
  });

  it('includes layout entries in manifest', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pages', '_layout.ts'), 'export class Layout {}');
    fs.writeFileSync(path.join(dir, 'pages', 'index.ts'), 'export class Page {}');

    const manifest = generateManifest(dir);
    expect(manifest.layouts).toHaveLength(1);
    expect(manifest.layouts[0].dir).toBe('');
    // page should reference the layout
    expect(manifest.routes[0].layouts).toEqual(['']);
  });

  it('includes API routes in manifest', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pages', 'index.ts'), 'export class Page {}');
    fs.writeFileSync(path.join(dir, 'api', 'users.ts'), 'export async function GET() {}');

    const manifest = generateManifest(dir);
    expect(manifest.apiRoutes).toHaveLength(1);
    expect(manifest.apiRoutes[0].path).toBe('/api/users');
    expect(manifest.apiRoutes[0].module).toBe('api/users.js');
  });

  it('detects hasLoader in manifest', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pages', 'index.ts'), 'export function loader() { return {}; }\nexport class Page {}');

    const manifest = generateManifest(dir);
    expect(manifest.routes[0].hasLoader).toBe(true);
    expect(manifest.routes[0].module).toBe('pages/index.js');
  });

  it('handles empty project', () => {
    const dir = createTmpDir();
    const manifest = generateManifest(dir);
    expect(manifest.routes).toEqual([]);
    expect(manifest.apiRoutes).toEqual([]);
    expect(manifest.layouts).toEqual([]);
  });

  it('includes layout chain for nested pages', () => {
    const dir = createTmpDir();
    fs.mkdirSync(path.join(dir, 'pages', 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pages', '_layout.ts'), 'export class Root {}');
    fs.writeFileSync(path.join(dir, 'pages', 'dashboard', '_layout.ts'), 'export class Dash {}');
    fs.writeFileSync(path.join(dir, 'pages', 'dashboard', 'index.ts'), 'export class Page {}');

    const manifest = generateManifest(dir);
    const dashPage = manifest.routes.find(r => r.path === '/dashboard');
    expect(dashPage!.layouts).toEqual(['', 'dashboard']);
  });
});
