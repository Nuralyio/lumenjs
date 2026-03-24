import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationStore } from './store.js';
import {
  handleCallInitiate,
  handleCallRespond,
  handleCallHangup,
  handleCallMediaToggle,
  handleSignalOffer,
  handleSignalAnswer,
  handleSignalIceCandidate,
  type SignalingContext,
} from './signaling.js';

function createMockSignalingCtx(userId = 'caller'): SignalingContext {
  const store = new CommunicationStore();
  return {
    userId,
    store,
    emitToSocket: vi.fn(),
    broadcastAll: vi.fn(),
  };
}

describe('signaling', () => {
  describe('call initiate', () => {
    it('creates a call and transitions to ringing', () => {
      const ctx = createMockSignalingCtx('caller');
      ctx.store.mapUserSocket('caller', 'caller-s1');
      ctx.store.mapUserSocket('callee', 'callee-s1');
      handleCallInitiate(ctx, { conversationId: 'c1', type: 'audio', calleeIds: ['callee'] });

      const calls = (ctx.emitToSocket as any).mock.calls;
      const callerCalls = calls.filter((c: any) => c[0] === 'caller-s1');
      const calleeCalls = calls.filter((c: any) => c[0] === 'callee-s1');
      expect(callerCalls.length).toBeGreaterThan(0);
      expect(callerCalls[0][1].event).toBe('call:state-changed');
      expect(callerCalls[0][1].data.state).toBe('initiating');
      // Verify callee was notified
      expect(calleeCalls.length).toBeGreaterThan(0);
      expect(calleeCalls[0][1].event).toBe('call:incoming');

      const call = ctx.store.getActiveCallForUser('caller');
      expect(call?.state).toBe('ringing');
    });

    it('rejects if caller already in a call', () => {
      const ctx = createMockSignalingCtx('caller');
      ctx.store.mapUserSocket('caller', 'caller-s1');
      // Pre-create an active call for the caller
      ctx.store.addCall({
        id: 'existing', conversationId: 'c0', type: 'audio', state: 'connected',
        callerId: 'caller', calleeIds: ['other'], participants: [],
      });
      handleCallInitiate(ctx, { conversationId: 'c2', type: 'video', calleeIds: ['callee'] });
      expect(ctx.emitToSocket).toHaveBeenCalledWith('caller-s1', expect.objectContaining({
        data: expect.objectContaining({ error: 'already_in_call' }),
      }));
    });

    it('rejects if callee is busy', () => {
      const ctx = createMockSignalingCtx('caller');
      ctx.store.mapUserSocket('caller', 'caller-s1');
      ctx.store.mapUserSocket('callee', 'callee-s1');
      // Make callee busy
      ctx.store.addCall({
        id: 'existing', conversationId: 'c0', type: 'audio', state: 'connected',
        callerId: 'other', calleeIds: ['callee'], participants: [],
      });
      handleCallInitiate(ctx, { conversationId: 'c1', type: 'audio', calleeIds: ['callee'] });
      expect(ctx.emitToSocket).toHaveBeenCalledWith('caller-s1', expect.objectContaining({
        data: expect.objectContaining({ endReason: 'busy' }),
      }));
    });
  });

  describe('call respond', () => {
    it('accept adds participant and transitions to connecting', () => {
      const ctx = createMockSignalingCtx('callee');
      ctx.store.mapUserSocket('caller', 'caller-s1');
      ctx.store.addCall({
        id: 'call1', conversationId: 'c1', type: 'audio', state: 'ringing',
        callerId: 'caller', calleeIds: ['callee'], participants: [{ userId: 'caller', joinedAt: '', audioMuted: false, videoMuted: true, screenSharing: false }],
      });
      handleCallRespond(ctx, { callId: 'call1', action: 'accept' });
      const call = ctx.store.getCall('call1');
      expect(call?.state).toBe('connecting');
      expect(call?.participants.length).toBe(2);
    });

    it('reject ends the call', () => {
      const ctx = createMockSignalingCtx('callee');
      ctx.store.mapUserSocket('caller', 'caller-s1');
      ctx.store.addCall({
        id: 'call1', conversationId: 'c1', type: 'audio', state: 'ringing',
        callerId: 'caller', calleeIds: ['callee'], participants: [],
      });
      handleCallRespond(ctx, { callId: 'call1', action: 'reject' });
      expect(ctx.store.getCall('call1')).toBeUndefined(); // removed after ended
    });
  });

  describe('call hangup', () => {
    it('ends call when last participant hangs up', () => {
      const ctx = createMockSignalingCtx('caller');
      ctx.store.mapUserSocket('callee', 'callee-s1');
      ctx.store.addCall({
        id: 'call1', conversationId: 'c1', type: 'audio', state: 'connected',
        callerId: 'caller', calleeIds: ['callee'],
        participants: [
          { userId: 'caller', joinedAt: '', audioMuted: false, videoMuted: true, screenSharing: false },
          { userId: 'callee', joinedAt: '', audioMuted: false, videoMuted: true, screenSharing: false },
        ],
      });
      handleCallHangup(ctx, { callId: 'call1', reason: 'completed' });
      expect(ctx.store.getCall('call1')).toBeUndefined();
    });
  });

  describe('media toggle', () => {
    it('toggles audio mute', () => {
      const ctx = createMockSignalingCtx('caller');
      ctx.store.mapUserSocket('callee', 'callee-s1');
      ctx.store.addCall({
        id: 'call1', conversationId: 'c1', type: 'video', state: 'connected',
        callerId: 'caller', calleeIds: ['callee'],
        participants: [
          { userId: 'caller', joinedAt: '', audioMuted: false, videoMuted: false, screenSharing: false },
          { userId: 'callee', joinedAt: '', audioMuted: false, videoMuted: false, screenSharing: false },
        ],
      });
      handleCallMediaToggle(ctx, { callId: 'call1', audio: false });
      expect(ctx.store.getCall('call1')?.participants[0].audioMuted).toBe(true);
    });
  });

  describe('WebRTC signal relay', () => {
    it('relays offer to target user', () => {
      const ctx = createMockSignalingCtx('caller');
      ctx.store.mapUserSocket('callee', 'callee-s1');
      handleSignalOffer(ctx, { callId: 'c1', fromUserId: 'caller', toUserId: 'callee', type: 'offer', sdp: 'sdp-data' });
      expect(ctx.emitToSocket).toHaveBeenCalledWith('callee-s1', expect.objectContaining({ event: 'signal:offer' }));
    });

    it('relays answer to target user', () => {
      const ctx = createMockSignalingCtx('callee');
      ctx.store.mapUserSocket('caller', 'caller-s1');
      handleSignalAnswer(ctx, { callId: 'c1', fromUserId: 'callee', toUserId: 'caller', type: 'answer', sdp: 'sdp-ans' });
      expect(ctx.emitToSocket).toHaveBeenCalledWith('caller-s1', expect.objectContaining({ event: 'signal:answer' }));
    });

    it('relays ICE candidate', () => {
      const ctx = createMockSignalingCtx('caller');
      ctx.store.mapUserSocket('callee', 'callee-s1');
      handleSignalIceCandidate(ctx, { callId: 'c1', fromUserId: 'caller', toUserId: 'callee', candidate: 'cand', sdpMLineIndex: 0, sdpMid: 'audio' });
      expect(ctx.emitToSocket).toHaveBeenCalledWith('callee-s1', expect.objectContaining({ event: 'signal:ice-candidate' }));
    });
  });
});
