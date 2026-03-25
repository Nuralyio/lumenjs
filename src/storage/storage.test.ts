import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { LocalStorageAdapter } from './adapters/local.js';
import { S3StorageAdapter } from './adapters/s3.js';
import { createStorage, useStorage, setStorage } from './index.js';

// ── LocalStorageAdapter ───────────────────────────────────────────

describe('LocalStorageAdapter', () => {
  let tmpDir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenjs-storage-test-'));
    adapter = new LocalStorageAdapter({ uploadDir: tmpDir, publicPath: '/uploads' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('put', () => {
    it('writes buffer to disk and returns stored file metadata', async () => {
      const data = Buffer.from('hello world');
      const result = await adapter.put(data, { mimeType: 'text/plain', fileName: 'hello.txt' });

      expect(result.size).toBe(11);
      expect(result.mimeType).toBe('text/plain');
      expect(result.fileName).toBe('hello.txt');
      expect(result.url).toMatch(/^\/uploads\/.+/);
      expect(fs.existsSync(path.join(tmpDir, result.key))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, result.key))).toEqual(data);
    });

    it('uses provided key', async () => {
      const result = await adapter.put(Buffer.from('data'), { key: 'custom/path/file.bin' });
      expect(result.key).toBe('custom/path/file.bin');
      expect(result.url).toBe('/uploads/custom/path/file.bin');
      expect(fs.existsSync(path.join(tmpDir, 'custom', 'path', 'file.bin'))).toBe(true);
    });

    it('auto-generates UUID key when not provided', async () => {
      const result = await adapter.put(Buffer.from('x'));
      expect(result.key).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('defaults mimeType to application/octet-stream', async () => {
      const result = await adapter.put(Buffer.from('x'));
      expect(result.mimeType).toBe('application/octet-stream');
    });
  });

  describe('delete', () => {
    it('removes file from disk', async () => {
      const { key } = await adapter.put(Buffer.from('to delete'));
      const filePath = path.join(tmpDir, key);
      expect(fs.existsSync(filePath)).toBe(true);
      await adapter.delete(key);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('does not throw if file does not exist', async () => {
      await expect(adapter.delete('nonexistent-key')).resolves.not.toThrow();
    });
  });

  describe('presignPut', () => {
    it('returns a token-based upload URL and stores the pending upload', async () => {
      const result = await adapter.presignPut('uploads/img.jpg', {
        mimeType: 'image/jpeg',
        expiresIn: 300,
        maxSize: 5_000_000,
      });

      expect(result.key).toBe('uploads/img.jpg');
      expect(result.uploadUrl).toMatch(/^\/__nk_storage\/upload\/[0-9a-f]{64}$/);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const token = result.uploadUrl.split('/').at(-1)!;
      const pending = adapter.pendingUploads.get(token);
      expect(pending?.key).toBe('uploads/img.jpg');
      expect(pending?.mimeType).toBe('image/jpeg');
      expect(pending?.maxSize).toBe(5_000_000);
    });

    it('default expiry is 3600 seconds', async () => {
      const before = Date.now();
      const result = await adapter.presignPut('file.bin');
      const expiryMs = new Date(result.expiresAt).getTime();
      expect(expiryMs - before).toBeGreaterThanOrEqual(3599_000);
      expect(expiryMs - before).toBeLessThanOrEqual(3601_000);
    });
  });

  describe('consumeUpload', () => {
    it('returns pending upload and removes the token', async () => {
      const { uploadUrl } = await adapter.presignPut('doc.pdf', { mimeType: 'application/pdf' });
      const token = uploadUrl.split('/').at(-1)!;

      const pending = adapter.consumeUpload(token);
      expect(pending?.key).toBe('doc.pdf');
      expect(pending?.mimeType).toBe('application/pdf');
      expect(adapter.pendingUploads.has(token)).toBe(false);
    });

    it('returns undefined for unknown token', () => {
      expect(adapter.consumeUpload('bad-token')).toBeUndefined();
    });

    it('returns undefined and cleans up expired tokens', async () => {
      const { uploadUrl } = await adapter.presignPut('f.bin', { expiresIn: -1 });
      const token = uploadUrl.split('/').at(-1)!;
      expect(adapter.consumeUpload(token)).toBeUndefined();
    });
  });

  describe('presignGet', () => {
    it('returns the public URL (local dev has no private URLs)', async () => {
      const url = await adapter.presignGet('some/file.png');
      expect(url).toBe('/uploads/some/file.png');
    });
  });

  describe('publicUrl', () => {
    it('constructs URL from publicPath and key', () => {
      expect(adapter.publicUrl('images/photo.jpg')).toBe('/uploads/images/photo.jpg');
    });

    it('strips trailing slash from publicPath', () => {
      const a = new LocalStorageAdapter({ uploadDir: tmpDir, publicPath: '/uploads/' });
      expect(a.publicUrl('x.bin')).toBe('/uploads/x.bin');
    });
  });
});

// ── S3StorageAdapter ──────────────────────────────────────────────

describe('S3StorageAdapter', () => {
  const opts = {
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'AKID',
    secretAccessKey: 'SECRET',
  };

  describe('publicUrl', () => {
    it('returns standard S3 URL', () => {
      const adapter = new S3StorageAdapter(opts);
      expect(adapter.publicUrl('photos/cat.jpg')).toBe(
        'https://test-bucket.s3.us-east-1.amazonaws.com/photos/cat.jpg',
      );
    });

    it('uses publicBaseUrl when provided', () => {
      const adapter = new S3StorageAdapter({ ...opts, publicBaseUrl: 'https://cdn.example.com/' });
      expect(adapter.publicUrl('img.jpg')).toBe('https://cdn.example.com/img.jpg');
    });

    it('uses endpoint + bucket path for MinIO / R2', () => {
      const adapter = new S3StorageAdapter({ ...opts, endpoint: 'https://minio.internal' });
      expect(adapter.publicUrl('file.bin')).toBe('https://minio.internal/test-bucket/file.bin');
    });
  });

  /** Build a mock S3 client context using proper function constructors (arrow functions can't be `new`-ed) */
  function buildMockClient() {
    const send = vi.fn().mockResolvedValue({});
    const capturedCmds: any[] = [];
    // Use regular function declarations so they can be used as constructors
    function PutObjectCommand(this: any, input: any) { this.input = input; capturedCmds.push({ cmd: 'Put', input }); }
    function DeleteObjectCommand(this: any, input: any) { this.input = input; capturedCmds.push({ cmd: 'Delete', input }); }
    function GetObjectCommand(this: any, input: any) { this.input = input; capturedCmds.push({ cmd: 'Get', input }); }
    return { s3: { send }, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, send, capturedCmds };
  }

  describe('put', () => {
    it('sends PutObjectCommand with correct params and returns stored file', async () => {
      const mockClient = buildMockClient();
      const adapter = new S3StorageAdapter(opts);
      vi.spyOn(adapter as any, 'getClient').mockResolvedValue(mockClient);

      const data = Buffer.from('file content');
      const result = await adapter.put(data, {
        key: 'uploads/test.jpg',
        mimeType: 'image/jpeg',
        fileName: 'test.jpg',
        acl: 'public-read',
      });

      expect(result.key).toBe('uploads/test.jpg');
      expect(result.size).toBe(12);
      expect(result.mimeType).toBe('image/jpeg');
      expect(mockClient.send).toHaveBeenCalledOnce();
      expect(mockClient.capturedCmds[0]).toMatchObject({
        cmd: 'Put',
        input: { Bucket: 'test-bucket', Key: 'uploads/test.jpg', ContentType: 'image/jpeg', ACL: 'public-read' },
      });
    });

    it('throws helpful error when getClient fails', async () => {
      const adapter = new S3StorageAdapter(opts);
      vi.spyOn(adapter as any, 'getClient').mockRejectedValue(
        new Error('[LumenJS:Storage] @aws-sdk/client-s3 is required for S3 storage. Install with: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'),
      );
      await expect(adapter.put(Buffer.from('x'))).rejects.toThrow(
        '@aws-sdk/client-s3 is required for S3 storage',
      );
    });
  });

  describe('delete', () => {
    it('sends DeleteObjectCommand with correct key', async () => {
      const mockClient = buildMockClient();
      const adapter = new S3StorageAdapter(opts);
      vi.spyOn(adapter as any, 'getClient').mockResolvedValue(mockClient);

      await adapter.delete('uploads/to-delete.bin');

      expect(mockClient.send).toHaveBeenCalledOnce();
      expect(mockClient.capturedCmds[0]).toMatchObject({
        cmd: 'Delete',
        input: { Bucket: 'test-bucket', Key: 'uploads/to-delete.bin' },
      });
    });
  });

  describe('presignPut', () => {
    it('returns presigned PUT URL from getSignedUrl', async () => {
      const mockSignedUrl = 'https://test-bucket.s3.us-east-1.amazonaws.com/file.bin?X-Amz-Signature=abc';
      const mockGetSignedUrl = vi.fn().mockResolvedValue(mockSignedUrl);

      const mockClient = buildMockClient();
      const adapter = new S3StorageAdapter(opts);
      vi.spyOn(adapter as any, 'getClient').mockResolvedValue(mockClient);
      vi.spyOn(adapter as any, 'getSignedUrl').mockResolvedValue(mockGetSignedUrl);

      const result = await adapter.presignPut('file.bin', { mimeType: 'application/octet-stream', expiresIn: 600 });

      expect(result.uploadUrl).toBe(mockSignedUrl);
      expect(result.key).toBe('file.bin');
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(mockGetSignedUrl).toHaveBeenCalledWith(mockClient.s3, expect.anything(), { expiresIn: 600 });
    });

    it('throws helpful error when presigner is unavailable', async () => {
      const mockClient = buildMockClient();
      const adapter = new S3StorageAdapter(opts);
      vi.spyOn(adapter as any, 'getClient').mockResolvedValue(mockClient);
      vi.spyOn(adapter as any, 'getSignedUrl').mockRejectedValue(
        new Error('[LumenJS:Storage] @aws-sdk/s3-request-presigner is required for presigned URLs. Install with: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'),
      );
      await expect(adapter.presignPut('f.bin')).rejects.toThrow(
        '@aws-sdk/s3-request-presigner is required for presigned URLs',
      );
    });
  });
});

// ── createStorage factory ─────────────────────────────────────────

describe('createStorage', () => {
  it('creates LocalStorageAdapter for provider: local', () => {
    const adapter = createStorage({ provider: 'local', uploadDir: os.tmpdir(), publicPath: '/files' });
    expect(adapter).toBeInstanceOf(LocalStorageAdapter);
  });

  it('uses default uploadDir and publicPath for local', () => {
    const adapter = createStorage({ provider: 'local' }) as LocalStorageAdapter;
    expect(adapter.uploadDir).toBe('./uploads');
    expect(adapter.publicPath).toBe('/uploads');
  });

  it('creates S3StorageAdapter for provider: s3', () => {
    const adapter = createStorage({
      provider: 's3',
      bucket: 'b',
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
    expect(adapter).toBeInstanceOf(S3StorageAdapter);
  });

  it('reads S3 credentials from env vars', () => {
    process.env.LUMENJS_S3_ACCESS_KEY = 'env-key';
    process.env.LUMENJS_S3_SECRET_KEY = 'env-secret';
    const adapter = createStorage({ provider: 's3', bucket: 'b', region: 'us-east-1' });
    expect(adapter).toBeInstanceOf(S3StorageAdapter);
    delete process.env.LUMENJS_S3_ACCESS_KEY;
    delete process.env.LUMENJS_S3_SECRET_KEY;
  });

  it('throws if S3 credentials are missing', () => {
    delete process.env.LUMENJS_S3_ACCESS_KEY;
    delete process.env.LUMENJS_S3_SECRET_KEY;
    expect(() => createStorage({ provider: 's3', bucket: 'b', region: 'us-east-1' })).toThrow(
      'S3 credentials are required',
    );
  });
});

// ── useStorage / setStorage singleton ────────────────────────────

describe('useStorage / setStorage', () => {
  afterEach(() => setStorage(null));

  it('returns null by default', () => {
    setStorage(null);
    expect(useStorage()).toBeNull();
  });

  it('returns the adapter after setStorage', () => {
    const adapter = createStorage({ provider: 'local', uploadDir: os.tmpdir(), publicPath: '/u' });
    setStorage(adapter);
    expect(useStorage()).toBe(adapter);
  });

  it('can be reset to null', () => {
    const adapter = createStorage({ provider: 'local', uploadDir: os.tmpdir(), publicPath: '/u' });
    setStorage(adapter);
    setStorage(null);
    expect(useStorage()).toBeNull();
  });
});
