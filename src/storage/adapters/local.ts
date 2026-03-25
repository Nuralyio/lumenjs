import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type {
  StorageAdapter,
  StoredFile,
  PutOptions,
  PresignPutOptions,
  PresignGetOptions,
  PresignedUpload,
} from './types.js';

interface PendingUpload {
  key: string;
  mimeType?: string;
  maxSize?: number;
  /** Absolute expiry time in ms (Date.now()) */
  expiresAt: number;
}

export interface LocalStorageOptions {
  /** Directory to write uploaded files to. Default: './uploads' */
  uploadDir: string;
  /** URL path prefix for serving files. Default: '/uploads' */
  publicPath: string;
}

/**
 * Local-disk storage adapter for development.
 *
 * Files are written to `uploadDir` and served at `publicPath`.
 * Presigned uploads use in-memory tokens consumed by `vite-plugin-storage`.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly uploadDir: string;
  readonly publicPath: string;

  /**
   * Pending presigned upload tokens.
   * Keyed by token → consumed by the Vite dev server plugin on upload.
   */
  readonly pendingUploads = new Map<string, PendingUpload>();

  constructor(options: LocalStorageOptions) {
    this.uploadDir = options.uploadDir;
    this.publicPath = options.publicPath.replace(/\/$/, '');
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async put(data: Buffer, options?: PutOptions): Promise<StoredFile> {
    const key = options?.key ?? crypto.randomUUID();
    const filePath = path.join(this.uploadDir, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return {
      key,
      url: this.publicUrl(key),
      size: data.length,
      mimeType: options?.mimeType ?? 'application/octet-stream',
      fileName: options?.fileName ?? key,
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.uploadDir, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async presignPut(key: string, options?: PresignPutOptions): Promise<PresignedUpload> {
    const expiresIn = options?.expiresIn ?? 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const token = crypto.randomBytes(32).toString('hex');
    this.pendingUploads.set(token, {
      key,
      mimeType: options?.mimeType,
      maxSize: options?.maxSize,
      expiresAt: expiresAt.getTime(),
    });
    return {
      uploadUrl: `/__nk_storage/upload/${token}`,
      key,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async presignGet(_key: string, _options?: PresignGetOptions): Promise<string> {
    // Local dev — files are served publicly at the static path.
    return this.publicUrl(_key);
  }

  publicUrl(key: string): string {
    return `${this.publicPath}/${key}`;
  }

  /**
   * Consume a presigned upload token.
   * Returns the pending upload metadata if the token is valid and unexpired, else undefined.
   * Calling this removes the token (one-time use).
   */
  consumeUpload(token: string): PendingUpload | undefined {
    const pending = this.pendingUploads.get(token);
    if (!pending) return undefined;
    this.pendingUploads.delete(token);
    if (Date.now() > pending.expiresAt) return undefined;
    return pending;
  }
}
