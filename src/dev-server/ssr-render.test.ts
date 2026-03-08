import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// discoverLayoutChain is private, so we test it indirectly by verifying
// the layout file discovery logic.

let tmpDir: string;

function createTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-ssr-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function findLayoutFile(dir: string): string | null {
  for (const ext of ['.ts', '.js']) {
    const p = path.join(dir, `_layout${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function discoverLayoutChain(pagesDir: string, pageFilePath: string): Array<{ dir: string; filePath: string }> {
  const relativeToPages = path.relative(pagesDir, pageFilePath).replace(/\\/g, '/');
  const dirParts = path.dirname(relativeToPages).split('/').filter(p => p && p !== '.');

  const chain: Array<{ dir: string; filePath: string }> = [];

  const rootLayout = findLayoutFile(pagesDir);
  if (rootLayout) chain.push({ dir: '', filePath: rootLayout });

  let currentDir = pagesDir;
  let relDir = '';
  for (const part of dirParts) {
    currentDir = path.join(currentDir, part);
    relDir = relDir ? `${relDir}/${part}` : part;
    const layoutFile = findLayoutFile(currentDir);
    if (layoutFile) chain.push({ dir: relDir, filePath: layoutFile });
  }

  return chain;
}

describe('discoverLayoutChain', () => {
  it('returns empty chain when no layouts exist', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    const chain = discoverLayoutChain(dir, path.join(dir, 'index.ts'));
    expect(chain).toEqual([]);
  });

  it('finds root layout', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), '');
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    const chain = discoverLayoutChain(dir, path.join(dir, 'index.ts'));
    expect(chain).toHaveLength(1);
    expect(chain[0].dir).toBe('');
  });

  it('finds nested layout chain', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), '');
    fs.mkdirSync(path.join(dir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard', '_layout.ts'), '');
    fs.writeFileSync(path.join(dir, 'dashboard', 'index.ts'), '');
    const chain = discoverLayoutChain(dir, path.join(dir, 'dashboard', 'index.ts'));
    expect(chain).toHaveLength(2);
    expect(chain[0].dir).toBe('');
    expect(chain[1].dir).toBe('dashboard');
  });

  it('skips directories without layouts', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), '');
    fs.mkdirSync(path.join(dir, 'app', 'settings'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', 'settings', 'index.ts'), '');
    // No layout in app/ directory
    const chain = discoverLayoutChain(dir, path.join(dir, 'app', 'settings', 'index.ts'));
    expect(chain).toHaveLength(1);
    expect(chain[0].dir).toBe('');
  });

  it('finds deeply nested layout chain', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.ts'), '');
    fs.mkdirSync(path.join(dir, 'app', 'admin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', '_layout.ts'), '');
    fs.writeFileSync(path.join(dir, 'app', 'admin', '_layout.ts'), '');
    fs.writeFileSync(path.join(dir, 'app', 'admin', 'index.ts'), '');
    const chain = discoverLayoutChain(dir, path.join(dir, 'app', 'admin', 'index.ts'));
    expect(chain).toHaveLength(3);
    expect(chain.map(l => l.dir)).toEqual(['', 'app', 'app/admin']);
  });

  it('detects .js layout files', () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, '_layout.js'), '');
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    const chain = discoverLayoutChain(dir, path.join(dir, 'index.ts'));
    expect(chain).toHaveLength(1);
    expect(chain[0].filePath).toContain('_layout.js');
  });
});
