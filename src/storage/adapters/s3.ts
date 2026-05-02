import crypto from 'crypto';
import type {
  StorageAdapter,
  StoredFile,
  PutOptions,
  PresignPutOptions,
  PresignGetOptions,
  PresignedUpload,
} from './types.js';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint for S3-compatible APIs: MinIO, Cloudflare R2, etc. */
  endpoint?: string;
  /** Public CDN base URL. Defaults to https://{bucket}.s3.{region}.amazonaws.com */
  publicBaseUrl?: string;
}

interface S3Client {
  send(command: any): Promise<any>;
}

interface S3Internals {
  s3: S3Client;
  PutObjectCommand: new (input: any) => any;
  DeleteObjectCommand: new (input: any) => any;
  GetObjectCommand: new (input: any) => any;
}

const SDK_INSTALL_HINT =
  'Install with: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner';

/**
 * S3-compatible storage adapter.
 * Works with AWS S3, Cloudflare R2, MinIO, and any S3-compatible API.
 *
 * Requires optional peer dependencies:
 *   @aws-sdk/client-s3
 *   @aws-sdk/s3-request-presigner
 */
export class S3StorageAdapter implements StorageAdapter {
  private readonly options: S3StorageOptions;
  private _client: S3Internals | null = null;
  private _getSignedUrl: ((client: S3Client, command: any, options: any) => Promise<string>) | null = null;

  constructor(options: S3StorageOptions) {
    this.options = options;
  }

  private async getClient(): Promise<S3Internals> {
    if (this._client) return this._client;
    let S3Client: any, PutObjectCommand: any, DeleteObjectCommand: any, GetObjectCommand: any;
    try {
      const mod = await import('@aws-sdk/client-s3' as string);
      S3Client = mod.S3Client;
      PutObjectCommand = mod.PutObjectCommand;
      DeleteObjectCommand = mod.DeleteObjectCommand;
      GetObjectCommand = mod.GetObjectCommand;
    } catch {
      throw new Error(`[LumenJS:Storage] @aws-sdk/client-s3 is required for S3 storage. ${SDK_INSTALL_HINT}`);
    }
    this._client = {
      s3: new S3Client({
        region: this.options.region,
        endpoint: this.options.endpoint,
        credentials: {
          accessKeyId: this.options.accessKeyId,
          secretAccessKey: this.options.secretAccessKey,
        },
        forcePathStyle: !!this.options.endpoint, // required for MinIO
      }),
      PutObjectCommand,
      DeleteObjectCommand,
      GetObjectCommand,
    };
    return this._client;
  }

  private async getSignedUrl(): Promise<(client: S3Client, command: any, opts: any) => Promise<string>> {
    if (this._getSignedUrl) return this._getSignedUrl;
    try {
      const mod = await import('@aws-sdk/s3-request-presigner' as string);
      this._getSignedUrl = mod.getSignedUrl;
      return this._getSignedUrl!;
    } catch {
      throw new Error(`[LumenJS:Storage] @aws-sdk/s3-request-presigner is required for presigned URLs. ${SDK_INSTALL_HINT}`);
    }
  }

  async put(data: Buffer, options?: PutOptions): Promise<StoredFile> {
    const key = options?.key ?? crypto.randomUUID();
    const mimeType = options?.mimeType ?? 'application/octet-stream';
    const acl = options?.acl ?? 'public-read';
    const { s3, PutObjectCommand } = await this.getClient();

    const cmd: any = {
      Bucket: this.options.bucket,
      Key: key,
      Body: data,
      ContentType: mimeType,
      // Public assets are content-addressed (random UUID keys) and never
      // mutated, so 1-year immutable caching is safe. Without this, R2's
      // public.r2.dev domain serves with no Cache-Control header and browsers
      // revalidate on every navigation.
      CacheControl: options?.cacheControl ?? 'public, max-age=31536000, immutable',
      ...(options?.fileName
        ? { ContentDisposition: `inline; filename="${options.fileName.replace(/[\r\n"\\]/g, '_')}"` }
        : {}),
    };
    // R2 and some S3-compatible APIs don't support ACL
    if (!this.options.endpoint) cmd.ACL = acl;
    await s3.send(new PutObjectCommand(cmd));

    return {
      key,
      url: this.publicUrl(key),
      size: data.length,
      mimeType,
      fileName: options?.fileName ?? key,
    };
  }

  async delete(key: string): Promise<void> {
    const { s3, DeleteObjectCommand } = await this.getClient();
    await s3.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async presignPut(key: string, options?: PresignPutOptions): Promise<PresignedUpload> {
    const expiresIn = options?.expiresIn ?? 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const { s3, PutObjectCommand } = await this.getClient();
    const getSignedUrl = await this.getSignedUrl();

    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      ...(options?.mimeType ? { ContentType: options.mimeType } : {}),
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn });
    return { uploadUrl, key, expiresAt: expiresAt.toISOString() };
  }

  async presignGet(key: string, options?: PresignGetOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? 3600;
    const { s3, GetObjectCommand } = await this.getClient();
    const getSignedUrl = await this.getSignedUrl();
    const command = new GetObjectCommand({ Bucket: this.options.bucket, Key: key });
    return getSignedUrl(s3, command, { expiresIn });
  }

  publicUrl(key: string): string {
    if (this.options.publicBaseUrl) {
      return `${this.options.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    }
    if (this.options.endpoint) {
      // MinIO / R2: {endpoint}/{bucket}/{key}
      return `${this.options.endpoint.replace(/\/$/, '')}/${this.options.bucket}/${key}`;
    }
    return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com/${key}`;
  }
}
