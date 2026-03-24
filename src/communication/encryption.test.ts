import { describe, it, expect, vi } from 'vitest';
import { CommunicationStore } from './store.js';
import {
  handleUploadKeys,
  handleRequestKeys,
  handleSessionInit,
  type EncryptionContext,
} from './encryption.js';

function createMockEncCtx(userId = 'user-1'): EncryptionContext {
  return {
    userId,
    store: new CommunicationStore(),
    push: vi.fn(),
    emitToUser: vi.fn(),
  };
}

const mockBundle = {
  userId: 'user-1',
  identityKey: 'ik1',
  signedPreKey: { keyId: 1, publicKey: 'spk1' },
  signedPreKeySignature: 'sig1',
  oneTimePreKeys: [{ keyId: 10, publicKey: 'otk10' }, { keyId: 11, publicKey: 'otk11' }],
  uploadedAt: '',
};

describe('encryption handlers', () => {
  describe('upload keys', () => {
    it('stores key bundle in memory', () => {
      const ctx = createMockEncCtx('user-1');
      handleUploadKeys(ctx, mockBundle);
      expect(ctx.store.getKeyBundle('user-1')).toBeDefined();
      expect(ctx.store.getKeyBundle('user-1')?.identityKey).toBe('ik1');
      expect(ctx.push).toHaveBeenCalled();
    });

    it('overrides userId with context userId', () => {
      const ctx = createMockEncCtx('real-user');
      handleUploadKeys(ctx, { ...mockBundle, userId: 'fake-user' });
      expect(ctx.store.getKeyBundle('real-user')).toBeDefined();
      expect(ctx.store.getKeyBundle('fake-user')).toBeUndefined();
    });
  });

  describe('request keys', () => {
    it('returns recipient key bundle and pops one-time prekey', () => {
      const ctx = createMockEncCtx('requester');
      ctx.store.setKeyBundle('target', mockBundle);
      handleRequestKeys(ctx, { recipientId: 'target' });
      expect(ctx.push).toHaveBeenCalledWith(expect.objectContaining({
        event: 'encryption:keys-response',
        data: expect.objectContaining({
          recipientId: 'target',
          identityKey: 'ik1',
          oneTimePreKey: { keyId: 10, publicKey: 'otk10' },
        }),
      }));
      // One prekey consumed
      expect(ctx.store.getOneTimePreKeyCount('target')).toBe(1);
    });

    it('returns error if no keys for recipient', () => {
      const ctx = createMockEncCtx('requester');
      handleRequestKeys(ctx, { recipientId: 'unknown' });
      expect(ctx.push).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ error: 'no_keys' }),
      }));
    });

    it('notifies when prekeys depleted', () => {
      const ctx = createMockEncCtx('requester');
      ctx.store.setKeyBundle('target', { ...mockBundle, oneTimePreKeys: [{ keyId: 99, publicKey: 'last' }] });
      handleRequestKeys(ctx, { recipientId: 'target' });
      expect(ctx.emitToUser).toHaveBeenCalledWith('target', expect.objectContaining({
        event: 'encryption:keys-depleted',
      }));
    });
  });

  describe('session init', () => {
    it('relays session init to recipient', () => {
      const ctx = createMockEncCtx('sender');
      const envelope = { senderId: 'sender', recipientId: 'recipient', sessionId: 's1', ciphertext: 'enc', messageType: 'prekey' as const, senderIdentityKey: 'k1' };
      handleSessionInit(ctx, { recipientId: 'recipient', sessionId: 's1', envelope });
      expect(ctx.emitToUser).toHaveBeenCalledWith('recipient', expect.objectContaining({
        event: 'encryption:session-init',
        data: expect.objectContaining({ senderId: 'sender', sessionId: 's1' }),
      }));
    });
  });
});
