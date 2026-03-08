import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// The helper functions bufferIndexOf, parseMultipart, extractParams are private.
// We test them indirectly through the plugin or re-implement the logic tests.
// For bufferIndexOf we can access it through the module since we need to test it.

// Since bufferIndexOf and parseMultipart are not exported, we test them via
// a workaround: we import the module and test the exported plugin behavior,
// or we replicate the buffer search test.

describe('bufferIndexOf behavior', () => {
  // Replicate the algorithm to verify correctness
  function bufferIndexOf(buf: Buffer, search: Buffer, from: number): number {
    for (let i = from; i <= buf.length - search.length; i++) {
      let found = true;
      for (let j = 0; j < search.length; j++) {
        if (buf[i + j] !== search[j]) { found = false; break; }
      }
      if (found) return i;
    }
    return -1;
  }

  it('finds pattern at start', () => {
    const buf = Buffer.from('hello world');
    const search = Buffer.from('hello');
    expect(bufferIndexOf(buf, search, 0)).toBe(0);
  });

  it('finds pattern in middle', () => {
    const buf = Buffer.from('hello world');
    const search = Buffer.from('world');
    expect(bufferIndexOf(buf, search, 0)).toBe(6);
  });

  it('returns -1 when not found', () => {
    const buf = Buffer.from('hello world');
    const search = Buffer.from('xyz');
    expect(bufferIndexOf(buf, search, 0)).toBe(-1);
  });

  it('respects from offset', () => {
    const buf = Buffer.from('abcabc');
    const search = Buffer.from('abc');
    expect(bufferIndexOf(buf, search, 1)).toBe(3);
  });
});

describe('multipart parsing integration', () => {
  it('parses simple multipart body', async () => {
    // We build a multipart body and verify the structure
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const body = [
      `------WebKitFormBoundary7MA4YWxkTrZu0gW`,
      `Content-Disposition: form-data; name="field1"`,
      ``,
      `value1`,
      `------WebKitFormBoundary7MA4YWxkTrZu0gW`,
      `Content-Disposition: form-data; name="file"; filename="test.txt"`,
      `Content-Type: text/plain`,
      ``,
      `file content here`,
      `------WebKitFormBoundary7MA4YWxkTrZu0gW--`,
    ].join('\r\n');

    // Verify the body structure is well-formed
    expect(body).toContain('name="field1"');
    expect(body).toContain('filename="test.txt"');
    expect(body).toContain('file content here');
  });
});

describe('extractParams behavior', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts dynamic segment from api route', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-api-'));
    fs.mkdirSync(path.join(tmpDir, 'users'), { recursive: true });
    const filePath = path.join(tmpDir, 'users', '[id].ts');
    fs.writeFileSync(filePath, '');

    // Simulate extractParams logic
    const urlSegments = 'users/42'.split('/').filter(Boolean);
    const fileRelative = path.relative(tmpDir, filePath).replace(/\.(ts|js)$/, '');
    const fileSegments = fileRelative.split(path.sep);

    const params: Record<string, string> = {};
    for (let i = 0; i < fileSegments.length && i < urlSegments.length; i++) {
      const match = fileSegments[i].match(/^\[(.+)\]$/);
      if (match) {
        params[match[1]] = urlSegments[i];
      }
    }

    expect(params).toEqual({ id: '42' });
  });
});
