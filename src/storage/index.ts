import { LocalStorageAdapter } from './adapters/local.js';
import { S3StorageAdapter } from './adapters/s3.js';
import type { StorageAdapter } from './adapters/types.js';

export type { StorageAdapter, StoredFile, PutOptions, PresignPutOptions, PresignGetOptions, PresignedUpload } from './adapters/types.js';
export { LocalStorageAdapter } from './adapters/local.js';
export { S3StorageAdapter } from './adapters/s3.js';

// ── Config Types ──────────────────────────────────────────────────

export interface LocalStorageConfig {
  provider: 'local';
  /** Directory to write uploaded files. Default: './uploads' */
  uploadDir?: string;
  /** URL path prefix for serving files. Default: '/uploads' */
  publicPath?: string;
}

export interface S3StorageConfig {
  provider: 's3';
  bucket: string;
  region: string;
  /** Read from env var LUMENJS_S3_ACCESS_KEY if omitted */
  accessKeyId?: string;
  /** Read from env var LUMENJS_S3_SECRET_KEY if omitted */
  secretAccessKey?: string;
  /** Custom endpoint for MinIO / Cloudflare R2 / other S3-compatible APIs */
  endpoint?: string;
  /** Public CDN base URL. Defaults to https://{bucket}.s3.{region}.amazonaws.com */
  publicBaseUrl?: string;
}

export type StorageConfig = LocalStorageConfig | S3StorageConfig;

// ── Factory ───────────────────────────────────────────────────────

/**
 * Create a storage adapter from a config object.
 *
 * @example
 * ```ts
 * // Local dev (default)
 * const storage = createStorage({ provider: 'local', uploadDir: './uploads' });
 *
 * // AWS S3
 * const storage = createStorage({
 *   provider: 's3',
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 * });
 *
 * // MinIO / Cloudflare R2
 * const storage = createStorage({
 *   provider: 's3',
 *   endpoint: 'https://minio.example.com',
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   accessKeyId: process.env.MINIO_KEY!,
 *   secretAccessKey: process.env.MINIO_SECRET!,
 * });
 * ```
 */
export function createStorage(config: StorageConfig): StorageAdapter {
  if (config.provider === 's3') {
    const accessKeyId = config.accessKeyId ?? process.env.LUMENJS_S3_ACCESS_KEY ?? '';
    const secretAccessKey = config.secretAccessKey ?? process.env.LUMENJS_S3_SECRET_KEY ?? '';
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        '[LumenJS:Storage] S3 credentials are required. ' +
        'Set accessKeyId/secretAccessKey in config, or set LUMENJS_S3_ACCESS_KEY / LUMENJS_S3_SECRET_KEY env vars.',
      );
    }
    return new S3StorageAdapter({
      bucket: config.bucket,
      region: config.region,
      accessKeyId,
      secretAccessKey,
      endpoint: config.endpoint,
      publicBaseUrl: config.publicBaseUrl,
    });
  }

  return new LocalStorageAdapter({
    uploadDir: config.uploadDir ?? './uploads',
    publicPath: config.publicPath ?? '/uploads',
  });
}

// ── Singleton ─────────────────────────────────────────────────────

let _storage: StorageAdapter | null = null;

/**
 * Get the global storage adapter (set by the LumenJS runtime or your app).
 * Returns null if storage has not been configured.
 *
 * Available as `req.storage` in API route handlers.
 */
export function useStorage(): StorageAdapter | null {
  return _storage;
}

/**
 * Set the global storage adapter.
 * Call this in a `_middleware.ts` or app startup to configure storage.
 *
 * @example
 * ```ts
 * // pages/_middleware.ts
 * import { setStorage, createStorage } from '@nuraly/lumenjs/dist/storage/index.js';
 *
 * setStorage(createStorage({ provider: 'local' }));
 * ```
 *
 * @internal also called by vite-plugin-storage in dev mode
 */
export function setStorage(adapter: StorageAdapter | null): void {
  _storage = adapter;
}
