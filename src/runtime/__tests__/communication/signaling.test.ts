import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSocket,
  setSocket,
  sendOffer,
  sendAnswer,
  sendIceCandidate,
  onSignalOffer,
  onSignalAnswer,
  onIceCandidate,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── WebRTC signaling emit actions ────────────────────────────────────────────

describe('WebRTC signaling emit actions', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('sendOffer emits nk:signal:offer with correct fields', () => {
    sendOffer('call-1', 'user-2', 'sdp-offer-string');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:signal:offer');
    expect(payload.callId).toBe('call-1');
    expect(payload.toUserId).toBe('user-2');
    expect(payload.sdp).toBe('sdp-offer-string');
    expect(payload.type).toBe('offer');
    expect(payload.fromUserId).toBe('');
  });

  it('sendAnswer emits nk:signal:answer with correct fields', () => {
    sendAnswer('call-1', 'user-2', 'sdp-answer-string');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:signal:answer');
    expect(payload.callId).toBe('call-1');
    expect(payload.toUserId).toBe('user-2');
    expect(payload.sdp).toBe('sdp-answer-string');
    expect(payload.type).toBe('answer');
    expect(payload.fromUserId).toBe('');
  });

  it('sendIceCandidate emits nk:signal:ice-candidate with all fields', () => {
    sendIceCandidate('call-1', 'user-2', 'candidate-string', 0, 'audio');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:signal:ice-candidate');
    expect(payload.callId).toBe('call-1');
    expect(payload.toUserId).toBe('user-2');
    expect(payload.candidate).toBe('candidate-string');
    expect(payload.sdpMLineIndex).toBe(0);
    expect(payload.sdpMid).toBe('audio');
    expect(payload.fromUserId).toBe('');
  });

  it('sendIceCandidate handles null sdpMLineIndex and sdpMid', () => {
    sendIceCandidate('call-1', 'user-2', 'candidate', null, null);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.sdpMLineIndex).toBeNull();
    expect(payload.sdpMid).toBeNull();
  });

  it('signaling emits are no-ops when socket is null — do not throw', () => {
    disconnect();
    expect(() => sendOffer('c', 'u', 'sdp')).not.toThrow();
    expect(() => sendAnswer('c', 'u', 'sdp')).not.toThrow();
    expect(() => sendIceCandidate('c', 'u', 'cand', 0, 'audio')).not.toThrow();
  });
});

// ── WebRTC signaling listeners ───────────────────────────────────────────────

describe('WebRTC signaling listeners', () => {
  let sock: any;
  beforeEach(() => { sock = makeMockSocket(); setSocket(sock); });

  const cases: Array<[string, (h: any) => () => void, string, any]> = [
    ['onSignalOffer', onSignalOffer, 'signal:offer', { callId: 'c1', fromUserId: 'u1', sdp: 'sdp' }],
    ['onSignalAnswer', onSignalAnswer, 'signal:answer', { callId: 'c1', fromUserId: 'u1', sdp: 'sdp' }],
    ['onIceCandidate', onIceCandidate, 'signal:ice-candidate', { callId: 'c1', fromUserId: 'u1', candidate: 'x', sdpMLineIndex: 0, sdpMid: 'audio' }],
  ];

  for (const [fnName, register, eventName, payload] of cases) {
    it(`${fnName}() fires on "${eventName}" events`, () => {
      const h = vi.fn();
      register(h);
      sock._trigger({ event: eventName, data: payload });
      expect(h).toHaveBeenCalledWith(payload);
    });

    it(`${fnName}() does NOT fire on other events`, () => {
      const h = vi.fn();
      register(h);
      sock._trigger({ event: 'unrelated:event', data: {} });
      expect(h).not.toHaveBeenCalled();
    });

    it(`${fnName}() unsub stops delivery`, () => {
      const h = vi.fn();
      const unsub = register(h);
      unsub();
      sock._trigger({ event: eventName, data: payload });
      expect(h).not.toHaveBeenCalled();
    });
  }
});
