import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationStore } from './store.js';

describe('CommunicationStore', () => {
  let store: CommunicationStore;

  beforeEach(() => {
    store = new CommunicationStore();
  });

  describe('user-socket mapping', () => {
    it('maps and retrieves sockets for a user', () => {
      store.mapUserSocket('u1', 's1');
      store.mapUserSocket('u1', 's2');
      expect(store.getSocketsForUser('u1').size).toBe(2);
      expect(store.getUserForSocket('s1')).toBe('u1');
    });

    it('unmaps socket and returns userId', () => {
      store.mapUserSocket('u1', 's1');
      const userId = store.unmapUserSocket('s1');
      expect(userId).toBe('u1');
      expect(store.getSocketsForUser('u1').size).toBe(0);
    });

    it('returns undefined for unknown socket', () => {
      expect(store.unmapUserSocket('unknown')).toBeUndefined();
    });

    it('tracks online status', () => {
      expect(store.isUserOnline('u1')).toBe(false);
      store.mapUserSocket('u1', 's1');
      expect(store.isUserOnline('u1')).toBe(true);
      store.unmapUserSocket('s1');
      expect(store.isUserOnline('u1')).toBe(false);
    });
  });

  describe('presence', () => {
    it('sets and gets presence', () => {
      const entry = store.setPresence('u1', 'online');
      expect(entry.userId).toBe('u1');
      expect(entry.status).toBe('online');
      expect(store.getPresence('u1')?.status).toBe('online');
    });

    it('updates presence status', () => {
      store.setPresence('u1', 'online');
      store.setPresence('u1', 'away');
      expect(store.getPresence('u1')?.status).toBe('away');
    });

    it('removes presence', () => {
      store.setPresence('u1', 'online');
      store.removePresence('u1');
      expect(store.getPresence('u1')).toBeUndefined();
    });
  });

  describe('typing', () => {
    it('tracks typing users', () => {
      store.setTyping('conv1', 'u1', () => {});
      expect(store.getTypingUsers('conv1')).toEqual(['u1']);
    });

    it('clears typing', () => {
      store.setTyping('conv1', 'u1', () => {});
      store.clearTyping('conv1', 'u1');
      expect(store.getTypingUsers('conv1')).toEqual([]);
    });

    it('auto-expires typing', async () => {
      vi.useFakeTimers();
      const onExpire = vi.fn();
      store.setTyping('conv1', 'u1', onExpire);
      vi.advanceTimersByTime(5000);
      expect(onExpire).toHaveBeenCalled();
      expect(store.getTypingUsers('conv1')).toEqual([]);
      vi.useRealTimers();
    });

    it('clears all typing for a user', () => {
      store.setTyping('conv1', 'u1', () => {});
      store.setTyping('conv2', 'u1', () => {});
      const cleared = store.clearAllTypingForUser('u1');
      expect(cleared).toEqual(['conv1', 'conv2']);
      expect(store.getTypingUsers('conv1')).toEqual([]);
      expect(store.getTypingUsers('conv2')).toEqual([]);
    });
  });

  describe('calls', () => {
    function makeMockCall(): any {
      return {
        id: 'call1', conversationId: 'conv1', type: 'audio', state: 'ringing',
        callerId: 'u1', calleeIds: ['u2'], participants: [{ userId: 'u1', joinedAt: '', audioMuted: false, videoMuted: true, screenSharing: false }],
      };
    }

    it('adds and retrieves call', () => {
      const call = makeMockCall();
      store.addCall(call);
      expect(store.getCall('call1')).toBe(call);
    });

    it('updates call state', () => {
      store.addCall(makeMockCall());
      store.updateCallState('call1', 'ringing');
      expect(store.getCall('call1')?.state).toBe('ringing');
    });

    it('sets answeredAt on connected', () => {
      store.addCall(makeMockCall());
      store.updateCallState('call1', 'connected');
      expect(store.getCall('call1')?.answeredAt).toBeDefined();
    });

    it('sets endedAt on ended', () => {
      store.addCall(makeMockCall());
      store.updateCallState('call1', 'ended', 'completed');
      expect(store.getCall('call1')?.endedAt).toBeDefined();
      expect(store.getCall('call1')?.endReason).toBe('completed');
    });

    it('adds and removes participants', () => {
      store.addCall(makeMockCall());
      store.addCallParticipant('call1', { userId: 'u2', joinedAt: '', audioMuted: false, videoMuted: false, screenSharing: false });
      expect(store.getCall('call1')?.participants.length).toBe(2);
      store.removeCallParticipant('call1', 'u2');
      expect(store.getCall('call1')?.participants.length).toBe(1);
    });

    it('finds active call for user', () => {
      store.addCall(makeMockCall());
      expect(store.getActiveCallForUser('u1')?.id).toBe('call1');
      expect(store.getActiveCallForUser('u2')?.id).toBe('call1');
      expect(store.getActiveCallForUser('u3')).toBeUndefined();
    });

    it('removes call', () => {
      store.addCall(makeMockCall());
      store.removeCall('call1');
      expect(store.getCall('call1')).toBeUndefined();
    });
  });

  describe('key bundles', () => {
    const mockBundle = {
      userId: 'u1', identityKey: 'ik1', signedPreKey: { keyId: 1, publicKey: 'spk1' },
      signedPreKeySignature: 'sig1', oneTimePreKeys: [{ keyId: 10, publicKey: 'otk10' }, { keyId: 11, publicKey: 'otk11' }], uploadedAt: '',
    };

    it('sets and gets key bundle', () => {
      store.setKeyBundle('u1', mockBundle);
      expect(store.getKeyBundle('u1')?.identityKey).toBe('ik1');
    });

    it('pops one-time prekey (consumed once)', () => {
      store.setKeyBundle('u1', mockBundle);
      const key = store.popOneTimePreKey('u1');
      expect(key?.keyId).toBe(10);
      expect(store.getOneTimePreKeyCount('u1')).toBe(1);
      const key2 = store.popOneTimePreKey('u1');
      expect(key2?.keyId).toBe(11);
      expect(store.getOneTimePreKeyCount('u1')).toBe(0);
      expect(store.popOneTimePreKey('u1')).toBeUndefined();
    });

    it('removes key bundle', () => {
      store.setKeyBundle('u1', mockBundle);
      store.removeKeyBundle('u1');
      expect(store.getKeyBundle('u1')).toBeUndefined();
    });
  });
});
