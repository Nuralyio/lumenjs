import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSocket,
  setSocket,
  onIncomingCall,
  onCallStateChanged,
  onParticipantJoined,
  onParticipantLeft,
  onMediaChanged,
  initiateCall,
  respondToCall,
  hangup,
  toggleMedia,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Call emit actions ────────────────────────────────────────────────────────

describe('call emit actions', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('initiateCall emits nk:call:initiate with all fields', () => {
    initiateCall('conv-1', 'video', ['u2', 'u3'], {
      callerName: 'Alice', callerInitials: 'AL', callerColor: '#f00',
    });
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:call:initiate');
    expect(payload.conversationId).toBe('conv-1');
    expect(payload.type).toBe('video');
    expect(payload.calleeIds).toEqual(['u2', 'u3']);
    expect(payload.callerName).toBe('Alice');
    expect(payload.callerInitials).toBe('AL');
    expect(payload.callerColor).toBe('#f00');
  });

  it('initiateCall works without caller metadata', () => {
    initiateCall('conv-1', 'audio', ['u2']);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.conversationId).toBe('conv-1');
    expect(payload.type).toBe('audio');
    expect(payload.calleeIds).toEqual(['u2']);
  });

  it('respondToCall emits nk:call:respond with callId and action', () => {
    respondToCall('call-99', 'accept');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:call:respond');
    expect(payload).toEqual({ callId: 'call-99', action: 'accept' });
  });

  it('respondToCall with reject action', () => {
    respondToCall('call-99', 'reject');
    expect(getSocket().emit.mock.calls[0][1].action).toBe('reject');
  });

  it('hangup emits nk:call:hangup with default reason "completed"', () => {
    hangup('call-1');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:call:hangup');
    expect(payload.callId).toBe('call-1');
    expect(payload.reason).toBe('completed');
    expect(payload).not.toHaveProperty('duration');
  });

  it('hangup includes duration when provided', () => {
    hangup('call-1', 'completed', '120');
    expect(getSocket().emit.mock.calls[0][1].duration).toBe('120');
  });

  it('hangup with custom reason', () => {
    hangup('call-1', 'declined');
    expect(getSocket().emit.mock.calls[0][1].reason).toBe('declined');
  });

  it('toggleMedia emits nk:call:media-toggle with callId and options', () => {
    toggleMedia('call-1', { audio: false, video: true, screenShare: false });
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:call:media-toggle');
    expect(payload.callId).toBe('call-1');
    expect(payload.audio).toBe(false);
    expect(payload.video).toBe(true);
    expect(payload.screenShare).toBe(false);
  });

  it('call emits are no-ops when socket is null — do not throw', () => {
    disconnect();
    expect(() => initiateCall('c', 'audio', [])).not.toThrow();
    expect(() => respondToCall('x', 'accept')).not.toThrow();
    expect(() => hangup('x')).not.toThrow();
    expect(() => toggleMedia('x', {})).not.toThrow();
  });
});

// ── Call event listeners ─────────────────────────────────────────────────────

describe('call event listeners', () => {
  let sock: any;
  beforeEach(() => { sock = makeMockSocket(); setSocket(sock); });

  const cases: Array<[string, (h: any) => () => void, string, any]> = [
    ['onIncomingCall', onIncomingCall, 'call:incoming', { callId: 'c1', type: 'video' }],
    ['onCallStateChanged', onCallStateChanged, 'call:state-changed', { callId: 'c1', state: 'ended' }],
    ['onParticipantJoined', onParticipantJoined, 'call:participant-joined', { callId: 'c1', participant: { userId: 'u1' } }],
    ['onParticipantLeft', onParticipantLeft, 'call:participant-left', { callId: 'c1', userId: 'u1' }],
    ['onMediaChanged', onMediaChanged, 'call:media-changed', { callId: 'c1', userId: 'u1', audio: false }],
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
