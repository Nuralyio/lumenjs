import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readProjectConfig, readProjectTitle, getLumenJSNodeModules, getLumenJSDirs } from './config.js';

describe('readProjectConfig', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when config file is missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cfg-'));
    const config = readProjectConfig(tmpDir);
    expect(config.title).toBe('LumenJS App');
    expect(config.integrations).toEqual([]);
    expect(config.i18n).toBeUndefined();
  });

  it('reads title from config', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cfg-'));
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.config.ts'),
      `export default { title: 'My App' };`
    );
    const config = readProjectConfig(tmpDir);
    expect(config.title).toBe('My App');
  });

  it('reads integrations array', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cfg-'));
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.config.ts'),
      `export default { title: 'App', integrations: ['tailwind', 'nuralyui'] };`
    );
    const config = readProjectConfig(tmpDir);
    expect(config.integrations).toEqual(['tailwind', 'nuralyui']);
  });

  it('reads i18n config block', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cfg-'));
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.config.ts'),
      `export default {
        title: 'App',
        i18n: {
          locales: ['en', 'fr'],
          defaultLocale: 'en',
          prefixDefault: true,
        },
      };`
    );
    const config = readProjectConfig(tmpDir);
    expect(config.i18n).toEqual({
      locales: ['en', 'fr'],
      defaultLocale: 'en',
      prefixDefault: true,
    });
  });

  it('handles malformed config gracefully', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cfg-'));
    fs.writeFileSync(path.join(tmpDir, 'lumenjs.config.ts'), '{{invalid');
    const config = readProjectConfig(tmpDir);
    expect(config.title).toBe('LumenJS App');
    expect(config.integrations).toEqual([]);
  });

  it('defaults prefixDefault to false', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cfg-'));
    fs.writeFileSync(
      path.join(tmpDir, 'lumenjs.config.ts'),
      `export default {
        i18n: { locales: ['en'], defaultLocale: 'en' },
      };`
    );
    const config = readProjectConfig(tmpDir);
    expect(config.i18n!.prefixDefault).toBe(false);
  });
});

describe('readProjectTitle', () => {
  it('returns default title', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cfg-'));
    expect(readProjectTitle(tmpDir)).toBe('LumenJS App');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('getLumenJSNodeModules', () => {
  it('returns a path ending with node_modules', () => {
    const p = getLumenJSNodeModules();
    expect(p).toContain('node_modules');
  });
});

describe('getLumenJSDirs', () => {
  it('returns distDir, runtimeDir, editorDir', () => {
    const dirs = getLumenJSDirs();
    expect(dirs.distDir).toContain('dist');
    expect(dirs.runtimeDir).toContain('runtime');
    expect(dirs.editorDir).toContain('editor');
  });
});
