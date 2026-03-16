import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EditorFileService } from './file-service.js';

describe('EditorFileService', () => {
  let tmpDir: string;
  let service: EditorFileService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-editor-fs-'));
    service = new EditorFileService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('listFiles', () => {
    it('returns empty array for empty directory', () => {
      expect(service.listFiles()).toEqual([]);
    });

    it('returns empty array for non-existent directory', () => {
      const svc = new EditorFileService('/tmp/nonexistent-lumen-test-dir');
      expect(svc.listFiles()).toEqual([]);
    });

    it('lists files recursively', () => {
      fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'pages/index.ts'), 'export default {};');
      fs.writeFileSync(path.join(tmpDir, 'lumenjs.config.ts'), 'export default {};');

      const files = service.listFiles();
      expect(files).toContain('pages/index.ts');
      expect(files).toContain('lumenjs.config.ts');
    });

    it('excludes node_modules', () => {
      fs.mkdirSync(path.join(tmpDir, 'node_modules/lit'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'node_modules/lit/index.js'), '');
      fs.writeFileSync(path.join(tmpDir, 'index.ts'), '');

      const files = service.listFiles();
      expect(files).toEqual(['index.ts']);
    });

    it('excludes .git', () => {
      fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.git/config'), '');
      fs.writeFileSync(path.join(tmpDir, 'index.ts'), '');

      const files = service.listFiles();
      expect(files).toEqual(['index.ts']);
    });

    it('excludes .lumenjs', () => {
      fs.mkdirSync(path.join(tmpDir, '.lumenjs'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.lumenjs/cache'), '');
      fs.writeFileSync(path.join(tmpDir, 'index.ts'), '');

      const files = service.listFiles();
      expect(files).toEqual(['index.ts']);
    });
  });

  describe('readFile', () => {
    it('reads file content', () => {
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'world');
      expect(service.readFile('hello.txt')).toBe('world');
    });

    it('reads nested file', () => {
      fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'pages/index.ts'), 'content');
      expect(service.readFile('pages/index.ts')).toBe('content');
    });

    it('throws on non-existent file', () => {
      expect(() => service.readFile('missing.txt')).toThrow();
    });
  });

  describe('writeFile', () => {
    it('writes file content', () => {
      service.writeFile('test.txt', 'hello');
      expect(fs.readFileSync(path.join(tmpDir, 'test.txt'), 'utf-8')).toBe('hello');
    });

    it('creates parent directories', () => {
      service.writeFile('deep/nested/file.ts', 'code');
      expect(fs.readFileSync(path.join(tmpDir, 'deep/nested/file.ts'), 'utf-8')).toBe('code');
    });

    it('overwrites existing file', () => {
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'old');
      service.writeFile('file.txt', 'new');
      expect(fs.readFileSync(path.join(tmpDir, 'file.txt'), 'utf-8')).toBe('new');
    });
  });

  describe('path traversal protection', () => {
    it('blocks .. traversal on read', () => {
      expect(() => service.readFile('../../../etc/passwd')).toThrow('Path traversal detected');
    });

    it('blocks .. traversal on write', () => {
      expect(() => service.writeFile('../escape.txt', 'evil')).toThrow('Path traversal detected');
    });

    it('blocks absolute path on read', () => {
      expect(() => service.readFile('/etc/passwd')).toThrow('Path traversal detected');
    });

    it('allows normal nested paths', () => {
      service.writeFile('pages/about/index.ts', 'ok');
      expect(service.readFile('pages/about/index.ts')).toBe('ok');
    });
  });
});
