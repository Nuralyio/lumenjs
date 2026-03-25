export interface StoredFile {
  /** Storage key (path within bucket / upload-dir) */
  key: string;
  /** Publicly accessible URL (for public-read files) */
  url: string;
  size: number;
  mimeType: string;
  fileName: string;
}

export interface PutOptions {
  /** Custom storage key. Auto-generated UUID if omitted. */
  key?: string;
  mimeType?: string;
  fileName?: string;
  /** Access control. Default: 'public-read' */
  acl?: 'public-read' | 'private';
}

export interface PresignPutOptions {
  /** Expected MIME type (enforced in local adapter; advisory on S3 via Content-Type condition) */
  mimeType?: string;
  /** URL expiry in seconds. Default: 3600 */
  expiresIn?: number;
  /** Maximum file size in bytes */
  maxSize?: number;
}

export interface PresignGetOptions {
  /** URL expiry in seconds. Default: 3600 */
  expiresIn?: number;
}

export interface PresignedUpload {
  /** Presigned URL the client should PUT the encrypted file to */
  uploadUrl: string;
  /** Storage key to reference the file after upload */
  key: string;
  /** ISO 8601 expiry timestamp */
  expiresAt: string;
}

/** Storage adapter interface — implement for any backend (S3, R2, MinIO, local disk, etc.) */
export interface StorageAdapter {
  /** Upload a file buffer server-side. Returns stored file metadata with URL. */
  put(data: Buffer, options?: PutOptions): Promise<StoredFile>;
  /** Delete a file by its storage key. */
  delete(key: string): Promise<void>;
  /**
   * Generate a presigned PUT URL for direct client-to-storage upload.
   * Used for E2E-encrypted chat attachments — the server never sees the plaintext file.
   */
  presignPut(key: string, options?: PresignPutOptions): Promise<PresignedUpload>;
  /** Generate a presigned GET URL for temporarily accessing a private file. */
  presignGet(key: string, options?: PresignGetOptions): Promise<string>;
  /** Return the permanent public URL for a public-read file. */
  publicUrl(key: string): string;
}
