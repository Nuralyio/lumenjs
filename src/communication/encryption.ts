import type { KeyBundle, KeyExchangeResponse, EncryptedEnvelope } from './types.js';
import type { CommunicationStore } from './store.js';
import type { LumenDb } from '../db/index.js';

/** Context for encryption handlers */
export interface EncryptionContext {
  userId: string;
  store: CommunicationStore;
  /** Emit data to the current socket */
  push: (data: any) => void;
  /** Emit to a specific user's sockets */
  emitToUser: (targetUserId: string, data: any) => void;
  /** LumenJS database instance (optional) */
  db?: LumenDb;
}

// ── Key Upload ──────────────────────────────────────────────────

/**
 * Handle a client uploading their public key bundle.
 * Server stores the bundle — it never sees private keys.
 */
export function handleUploadKeys(ctx: EncryptionContext, data: KeyBundle): void {
  // Ensure the bundle belongs to the sender
  const bundle: KeyBundle = {
    ...data,
    userId: ctx.userId,
    uploadedAt: new Date().toISOString(),
  };

  // Store in memory
  ctx.store.setKeyBundle(ctx.userId, bundle);

  // Persist to DB if available
  if (ctx.db) {
    ctx.db.run(
      `INSERT OR REPLACE INTO encryption_keys (user_id, identity_key, signed_pre_key_id, signed_pre_key, signed_pre_key_signature, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ctx.userId,
      bundle.identityKey,
      bundle.signedPreKey.keyId,
      bundle.signedPreKey.publicKey,
      bundle.signedPreKeySignature,
      bundle.uploadedAt,
    );

    // Replace one-time pre-keys
    ctx.db.run(`DELETE FROM encryption_prekeys WHERE user_id = ?`, ctx.userId);
    for (const otk of bundle.oneTimePreKeys) {
      ctx.db.run(
        `INSERT INTO encryption_prekeys (user_id, key_id, public_key) VALUES (?, ?, ?)`,
        ctx.userId,
        otk.keyId,
        otk.publicKey,
      );
    }
  }

  ctx.push({ event: 'encryption:keys-uploaded', data: { userId: ctx.userId, keyCount: bundle.oneTimePreKeys.length } });
}

// ── Key Request ─────────────────────────────────────────────────

/**
 * Handle a client requesting another user's key bundle for session setup.
 * Pops one one-time pre-key (consumed once).
 */
export function handleRequestKeys(ctx: EncryptionContext, data: { recipientId: string }): void {
  let bundle = ctx.store.getKeyBundle(data.recipientId);

  // Try loading from DB if not in memory
  if (!bundle && ctx.db) {
    const row = ctx.db.get<any>(
      `SELECT * FROM encryption_keys WHERE user_id = ?`,
      data.recipientId,
    );
    if (row) {
      const prekeys = ctx.db.all<any>(
        `SELECT key_id, public_key FROM encryption_prekeys WHERE user_id = ? ORDER BY key_id`,
        data.recipientId,
      );
      bundle = {
        userId: data.recipientId,
        identityKey: row.identity_key,
        signedPreKey: { keyId: row.signed_pre_key_id, publicKey: row.signed_pre_key },
        signedPreKeySignature: row.signed_pre_key_signature,
        oneTimePreKeys: prekeys.map((pk: any) => ({ keyId: pk.key_id, publicKey: pk.public_key })),
        uploadedAt: row.uploaded_at,
      };
      ctx.store.setKeyBundle(data.recipientId, bundle);
    }
  }

  if (!bundle) {
    ctx.push({ event: 'encryption:keys-response', data: { error: 'no_keys', recipientId: data.recipientId } });
    return;
  }

  // Pop one one-time pre-key (consumed once per session)
  const oneTimePreKey = ctx.store.popOneTimePreKey(data.recipientId);

  // Remove from DB too
  if (oneTimePreKey && ctx.db) {
    ctx.db.run(
      `DELETE FROM encryption_prekeys WHERE user_id = ? AND key_id = ?`,
      data.recipientId,
      oneTimePreKey.keyId,
    );
  }

  const response: KeyExchangeResponse = {
    recipientId: data.recipientId,
    identityKey: bundle.identityKey,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    oneTimePreKey,
  };

  ctx.push({ event: 'encryption:keys-response', data: response });

  // Notify recipient if their one-time pre-keys are depleted
  if (ctx.store.getOneTimePreKeyCount(data.recipientId) === 0) {
    ctx.emitToUser(data.recipientId, {
      event: 'encryption:keys-depleted',
      data: { userId: data.recipientId },
    });
  }
}

// ── Session Init Relay ──────────────────────────────────────────

/**
 * Relay a session initialization message to the recipient.
 * The server never reads the envelope — just forwards it.
 */
export function handleSessionInit(
  ctx: EncryptionContext,
  data: { recipientId: string; sessionId: string; envelope: EncryptedEnvelope },
): void {
  ctx.emitToUser(data.recipientId, {
    event: 'encryption:session-init',
    data: {
      senderId: ctx.userId,
      sessionId: data.sessionId,
      envelope: data.envelope,
    },
  });
}
