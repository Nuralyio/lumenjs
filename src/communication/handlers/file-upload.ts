import type { HandlerContext } from './context.js';

// ── File Upload (Presigned URL) ──────────────────────────────────

/**
 * Handle a client requesting a presigned upload URL for a chat file attachment.
 *
 * E2E security model:
 *   1. Client encrypts the file locally (AES-256-GCM with a random key).
 *   2. This handler returns a presigned PUT URL — the server never sees the plaintext.
 *   3. Client PUTs the encrypted blob directly to storage (S3 / local).
 *   4. The file encryption key is included inside the Signal message envelope,
 *      encrypted per-recipient. The server cannot decrypt either the file or the key.
 */
export async function handleFileUploadRequest(
  ctx: HandlerContext,
  data: { conversationId: string; mimeType: string; size: number; fileName: string },
): Promise<void> {
  if (!ctx.storage) {
    ctx.push({
      event: 'file:upload-error',
      data: { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage is not configured on this server.' },
    });
    return;
  }

  // Validate against file upload config
  if (ctx.config.fileUpload) {
    const { maxFileSize, allowedMimeTypes } = ctx.config.fileUpload;

    if (data.size > maxFileSize) {
      ctx.push({
        event: 'file:upload-error',
        data: {
          code: 'FILE_TOO_LARGE',
          message: `File size ${data.size} exceeds maximum allowed size of ${maxFileSize} bytes.`,
        },
      });
      return;
    }

    if (allowedMimeTypes && allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(data.mimeType)) {
      ctx.push({
        event: 'file:upload-error',
        data: {
          code: 'MIME_TYPE_NOT_ALLOWED',
          message: `MIME type '${data.mimeType}' is not allowed.`,
        },
      });
      return;
    }
  }

  // Generate a unique file key scoped to the conversation
  const fileId = crypto.randomUUID();
  const ext = data.fileName.includes('.') ? `.${data.fileName.split('.').pop()}` : '';
  const key = `conversations/${data.conversationId}/${fileId}${ext}`;

  const presigned = await ctx.storage.presignPut(key, {
    mimeType: data.mimeType,
    expiresIn: 300, // 5 minutes to complete the upload
    maxSize: ctx.config.fileUpload?.maxFileSize,
  });

  ctx.push({
    event: 'file:upload-ready',
    data: {
      fileId,
      uploadUrl: presigned.uploadUrl,
      key: presigned.key,
      expiresAt: presigned.expiresAt,
    },
  });
}
