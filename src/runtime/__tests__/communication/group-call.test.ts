/**
 * Group call lifecycle tests
 *
 * Covers: typing signals during a call, joining/leaving a group while a call
 * is active, call signals (offer/answer/ICE) in group context, participant
 * join/leave events, media toggle during group call, and receiving messages
 * from group members while a call is ongoing.
 *
 * All scenarios use a single shared socket (the real-world case: layout sets
 * the socket via setSocket/connectChat and both chat and call share it).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectChat,
  setSocket,
  getSocket,
  onMessage,
  onTyping,
  onIncomingCall,
  onCallStateChanged,
  onParticipantJoined,
  onParticipantLeft,
  onMediaChanged,
  onSignalOffer,
  onSignalAnswer,
  onIceCandidate,
  startTyping,
  stopTyping,
  joinConversation,
  leaveConversation,
  initiateCall,
  respondToCall,
  hangup,
  toggleMedia,
  sendOffer,
  sendAnswer,
  sendIceCandidate,
  sendMessage,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Typing signals during an active call ────────────────────────────────────

describe('typing signals during an active group call', () => {
  it('typing start/stop emits while call is active — same socket', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    // Call is active (initiated by this user)
    initiateCall('group-conv-1', 'video', ['u2', 'u3']);

    // User types a message in the group chat while on call
    startTyping('group-conv-1');
    stopTyping('group-conv-1');

    const emits = sock.emit.mock.calls;
    const typingStart = emits.find(([e]: [string]) => e === 'nk:typing:start');
    const typingStop = emits.find(([e]: [string]) => e === 'nk:typing:stop');

    expect(typingStart).toBeDefined();
    expect(typingStart![1]).toEqual({ conversationId: 'group-conv-1' });
    expect(typingStop).toBeDefined();
    expect(typingStop![1]).toEqual({ conversationId: 'group-conv-1' });
  });

  it('receives typing indicator from group member during call', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const typingH = vi.fn();
    onTyping(typingH);

    // Another group member starts typing while the call is ongoing
    sock._trigger({
      event: 'typing:update',
      data: { conversationId: 'group-conv-1', userId: 'u2', isTyping: true },
    });

    expect(typingH).toHaveBeenCalledWith({
      conversationId: 'group-conv-1',
      userId: 'u2',
      isTyping: true,
    });
  });

  it('typing events from multiple group members during call are all received', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const events: any[] = [];
    onTyping((d) => events.push(d));

    // Three members type simultaneously during video call
    sock._trigger({ event: 'typing:update', data: { userId: 'u2', conversationId: 'g1', isTyping: true } });
    sock._trigger({ event: 'typing:update', data: { userId: 'u3', conversationId: 'g1', isTyping: true } });
    sock._trigger({ event: 'typing:update', data: { userId: 'u4', conversationId: 'g1', isTyping: false } });

    expect(events).toHaveLength(3);
    expect(events[0].userId).toBe('u2');
    expect(events[1].userId).toBe('u3');
    expect(events[2].isTyping).toBe(false);
  });

  it('typing in group does not interfere with call signal handlers', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const typingH = vi.fn();
    const offerH = vi.fn();
    onTyping(typingH);
    onSignalOffer(offerH);

    // Typing event arrives
    sock._trigger({ event: 'typing:update', data: { userId: 'u2', isTyping: true } });
    // SDP offer arrives
    sock._trigger({ event: 'signal:offer', data: { callId: 'c1', fromUserId: 'u3', sdp: 'sdp' } });

    expect(typingH).toHaveBeenCalledOnce();
    expect(offerH).toHaveBeenCalledOnce();
    expect(typingH).not.toHaveBeenCalledWith(expect.objectContaining({ callId: expect.anything() }));
    expect(offerH).not.toHaveBeenCalledWith(expect.objectContaining({ isTyping: expect.anything() }));
  });
});

// ── Join/leave conversation during an active group call ──────────────────────

describe('joining/leaving group conversation while call is active', () => {
  it('joinConversation emits correctly after call starts on same socket', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    // Call starts
    initiateCall('group-1', 'audio', ['u2', 'u3']);
    // User also joins the conversation room
    joinConversation('group-1');

    const emits = sock.emit.mock.calls;
    const joinCall = emits.find(([e]: [string]) => e === 'nk:call:initiate');
    const joinConv = emits.find(([e]: [string]) => e === 'nk:conversation:join');
    expect(joinCall).toBeDefined();
    expect(joinConv).toBeDefined();
    expect(joinConv![1]).toEqual({ conversationId: 'group-1' });
  });

  it('leaveConversation during active call does not affect call state', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const callStateH = vi.fn();
    onCallStateChanged(callStateH);

    // User leaves chat room during call (UI navigated away)
    leaveConversation('group-1');

    // Call state events still received
    sock._trigger({ event: 'call:state-changed', data: { callId: 'c1', state: 'active' } });
    expect(callStateH).toHaveBeenCalledWith({ callId: 'c1', state: 'active' });
    expect(sock.emit.mock.calls[0][0]).toBe('nk:conversation:leave');
  });

  it('joining multiple group conversations while on a call — all emits correct', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    initiateCall('group-1', 'video', ['u2']);
    joinConversation('group-1');
    joinConversation('group-2'); // joined additional conversation

    const emits = sock.emit.mock.calls.map(([e, p]: [string, any]) => ({ event: e, conv: p?.conversationId }));
    expect(emits.find((x) => x.event === 'nk:conversation:join' && x.conv === 'group-1')).toBeTruthy();
    expect(emits.find((x) => x.event === 'nk:conversation:join' && x.conv === 'group-2')).toBeTruthy();
  });

  it('receiving messages in group chat while call is in progress', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const msgH = vi.fn();
    const callH = vi.fn();
    onMessage(msgH);
    onCallStateChanged(callH);

    // Message arrives while call is ongoing
    sock._trigger({ event: 'message:new', data: { id: 1, text: 'still here?' } });
    // Call state also changes
    sock._trigger({ event: 'call:state-changed', data: { callId: 'c1', state: 'active' } });

    expect(msgH).toHaveBeenCalledWith({ id: 1, text: 'still here?' });
    expect(callH).toHaveBeenCalledWith({ callId: 'c1', state: 'active' });
  });
});

// ── Participant join/leave events in group call ──────────────────────────────

describe('group call participant join/exit events', () => {
  it('participant joining fires onParticipantJoined with correct data', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const joinH = vi.fn();
    onParticipantJoined(joinH);

    sock._trigger({
      event: 'call:participant-joined',
      data: { callId: 'c1', participant: { userId: 'u2', name: 'Bob' } },
    });
    expect(joinH).toHaveBeenCalledWith({ callId: 'c1', participant: { userId: 'u2', name: 'Bob' } });
  });

  it('participant leaving fires onParticipantLeft with correct data', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const leftH = vi.fn();
    onParticipantLeft(leftH);

    sock._trigger({
      event: 'call:participant-left',
      data: { callId: 'c1', userId: 'u3' },
    });
    expect(leftH).toHaveBeenCalledWith({ callId: 'c1', userId: 'u3' });
  });

  it('multiple participants joining one by one — all events delivered in order', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const joined: string[] = [];
    onParticipantJoined((d: any) => joined.push(d.participant.userId));

    sock._trigger({ event: 'call:participant-joined', data: { callId: 'c1', participant: { userId: 'u2' } } });
    sock._trigger({ event: 'call:participant-joined', data: { callId: 'c1', participant: { userId: 'u3' } } });
    sock._trigger({ event: 'call:participant-joined', data: { callId: 'c1', participant: { userId: 'u4' } } });

    expect(joined).toEqual(['u2', 'u3', 'u4']);
  });

  it('participant join followed by exit — both events delivered', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const joinH = vi.fn(), leftH = vi.fn();
    onParticipantJoined(joinH);
    onParticipantLeft(leftH);

    sock._trigger({ event: 'call:participant-joined', data: { callId: 'c1', participant: { userId: 'u2' } } });
    sock._trigger({ event: 'call:participant-left', data: { callId: 'c1', userId: 'u2' } });

    expect(joinH).toHaveBeenCalledOnce();
    expect(leftH).toHaveBeenCalledOnce();
    expect(joinH.mock.calls[0][0].participant.userId).toBe('u2');
    expect(leftH.mock.calls[0][0].userId).toBe('u2');
  });

  it('call ends (hangup) after all participants left', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    // All participants left
    sock._trigger({ event: 'call:participant-left', data: { callId: 'c1', userId: 'u2' } });
    sock._trigger({ event: 'call:participant-left', data: { callId: 'c1', userId: 'u3' } });

    // Hang up
    hangup('c1', 'all-left');

    const hangupEmit = sock.emit.mock.calls.find(([e]: [string]) => e === 'nk:call:hangup');
    expect(hangupEmit).toBeDefined();
    expect(hangupEmit![1]).toMatchObject({ callId: 'c1', reason: 'all-left' });
  });
});

// ── Media toggle during group call ───────────────────────────────────────────

describe('media toggle events during group call', () => {
  it('muting audio during group call emits correctly', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    toggleMedia('call-g1', { audio: false });
    const emit = sock.emit.mock.calls[0];
    expect(emit[0]).toBe('nk:call:media-toggle');
    expect(emit[1]).toMatchObject({ callId: 'call-g1', audio: false });
  });

  it('onMediaChanged fires when another participant mutes', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const mediaH = vi.fn();
    onMediaChanged(mediaH);

    sock._trigger({
      event: 'call:media-changed',
      data: { callId: 'c1', userId: 'u2', audio: false, video: true },
    });
    expect(mediaH).toHaveBeenCalledWith({ callId: 'c1', userId: 'u2', audio: false, video: true });
  });

  it('multiple media changes from different participants are all delivered', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const changes: string[] = [];
    onMediaChanged((d: any) => changes.push(d.userId));

    sock._trigger({ event: 'call:media-changed', data: { callId: 'c1', userId: 'u2', audio: false } });
    sock._trigger({ event: 'call:media-changed', data: { callId: 'c1', userId: 'u3', video: false } });
    sock._trigger({ event: 'call:media-changed', data: { callId: 'c1', userId: 'u4', screenShare: true } });

    expect(changes).toEqual(['u2', 'u3', 'u4']);
  });
});

// ── WebRTC signaling in group call context ───────────────────────────────────

describe('WebRTC signaling for group call (mesh topology)', () => {
  it('sends offer to each group participant independently', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    sendOffer('call-1', 'u2', 'sdp-offer-for-u2');
    sendOffer('call-1', 'u3', 'sdp-offer-for-u3');
    sendOffer('call-1', 'u4', 'sdp-offer-for-u4');

    const offers = sock.emit.mock.calls.filter(([e]: [string]) => e === 'nk:signal:offer');
    expect(offers).toHaveLength(3);
    expect(offers[0][1].toUserId).toBe('u2');
    expect(offers[1][1].toUserId).toBe('u3');
    expect(offers[2][1].toUserId).toBe('u4');
  });

  it('receives offers from multiple group participants', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const offerSenders: string[] = [];
    onSignalOffer((d: any) => offerSenders.push(d.fromUserId));

    sock._trigger({ event: 'signal:offer', data: { callId: 'c1', fromUserId: 'u2', sdp: 'sdp2' } });
    sock._trigger({ event: 'signal:offer', data: { callId: 'c1', fromUserId: 'u3', sdp: 'sdp3' } });

    expect(offerSenders).toEqual(['u2', 'u3']);
  });

  it('full WebRTC handshake for one peer: offer → answer → ICE candidates', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const offerH = vi.fn(), answerH = vi.fn(), iceH = vi.fn();
    onSignalOffer(offerH);
    onSignalAnswer(answerH);
    onIceCandidate(iceH);

    // Receive offer from u2
    sock._trigger({ event: 'signal:offer', data: { callId: 'c1', fromUserId: 'u2', sdp: 'offer-sdp' } });
    // Send answer back
    sendAnswer('c1', 'u2', 'answer-sdp');
    // Both sides exchange ICE candidates
    sock._trigger({ event: 'signal:ice-candidate', data: { callId: 'c1', fromUserId: 'u2', candidate: 'cand-1', sdpMLineIndex: 0, sdpMid: 'audio' } });
    sendIceCandidate('c1', 'u2', 'local-cand', 0, 'audio');

    expect(offerH).toHaveBeenCalledOnce();
    expect(answerH).not.toHaveBeenCalled(); // we sent it, not received
    const answerEmit = sock.emit.mock.calls.find(([e]: [string]) => e === 'nk:signal:answer');
    expect(answerEmit![1]).toMatchObject({ callId: 'c1', toUserId: 'u2', sdp: 'answer-sdp' });
    expect(iceH).toHaveBeenCalledWith({ callId: 'c1', fromUserId: 'u2', candidate: 'cand-1', sdpMLineIndex: 0, sdpMid: 'audio' });
  });

  it('call:incoming fires before WebRTC signaling begins (expected order)', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const events: string[] = [];
    onIncomingCall(() => events.push('incoming'));
    onSignalOffer(() => events.push('offer'));

    // Server sends incoming call first, then WebRTC starts
    sock._trigger({ event: 'call:incoming', data: { callId: 'c1', type: 'video' } });
    sock._trigger({ event: 'signal:offer', data: { callId: 'c1', fromUserId: 'u2', sdp: 'sdp' } });

    expect(events).toEqual(['incoming', 'offer']);
  });
});

// ── Full group call lifecycle scenario ───────────────────────────────────────

describe('full group call lifecycle', () => {
  it('complete group call: connect → join room → initiate call → participants join → chat → media → hang up', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const msgH = vi.fn();
    const joinH = vi.fn();
    const leftH = vi.fn();
    const mediaH = vi.fn();
    const stateH = vi.fn();
    onMessage(msgH);
    onParticipantJoined(joinH);
    onParticipantLeft(leftH);
    onMediaChanged(mediaH);
    onCallStateChanged(stateH);

    // 1. Join conversation room
    joinConversation('group-conv-1');

    // 2. Initiate video call to group
    initiateCall('group-conv-1', 'video', ['u2', 'u3', 'u4'], {
      callerName: 'Alice', callerInitials: 'AL',
    });

    // 3. Participants join
    sock._trigger({ event: 'call:participant-joined', data: { callId: 'c1', participant: { userId: 'u2' } } });
    sock._trigger({ event: 'call:participant-joined', data: { callId: 'c1', participant: { userId: 'u3' } } });

    // 4. Group member sends a message during the call
    sock._trigger({ event: 'message:new', data: { id: 1, senderId: 'u4', text: 'hello!' } });

    // 5. u2 mutes
    sock._trigger({ event: 'call:media-changed', data: { callId: 'c1', userId: 'u2', audio: false } });

    // 6. u3 leaves
    sock._trigger({ event: 'call:participant-left', data: { callId: 'c1', userId: 'u3' } });

    // 7. Call ends
    sock._trigger({ event: 'call:state-changed', data: { callId: 'c1', state: 'ended', endReason: 'host-left' } });
    hangup('c1', 'completed', '180');

    // Verify all events received
    expect(joinH).toHaveBeenCalledTimes(2);
    expect(msgH).toHaveBeenCalledWith({ id: 1, senderId: 'u4', text: 'hello!' });
    expect(mediaH).toHaveBeenCalledWith({ callId: 'c1', userId: 'u2', audio: false });
    expect(leftH).toHaveBeenCalledWith({ callId: 'c1', userId: 'u3' });
    expect(stateH).toHaveBeenCalledWith({ callId: 'c1', state: 'ended', endReason: 'host-left' });

    // Verify hangup emit
    const hangupEmit = sock.emit.mock.calls.find(([e]: [string]) => e === 'nk:call:hangup');
    expect(hangupEmit![1]).toMatchObject({ callId: 'c1', reason: 'completed', duration: '180' });
  });

  it('connectChat reuses socket during group call — no double socket created', async () => {
    // Scenario: layout calls connectChat, call starts via setSocket,
    // then messages page ALSO calls connectChat — must reuse, not create new socket
    const sock = makeMockSocket({ connected: true, active: true });
    mockIo.mockReturnValue(sock);
    await connectChat({ userId: 'alice', conversations: 'group-1' });

    // Call service replaces socket (same one via setSocket)
    setSocket(sock); // idempotent: same socket

    // Messages page calls connectChat AFTER call started
    const result = await connectChat({ userId: 'alice', conversations: 'group-1' });
    expect(result).toBe(sock); // must reuse
    expect(mockIo).toHaveBeenCalledOnce(); // not called again
  });

  it('handlers survive the entire call duration without re-registration', async () => {
    const sock = makeMockSocket({ connected: true, active: true });
    mockIo.mockReturnValue(sock);
    await connectChat({ userId: 'alice' });

    // Register all listeners once at session start
    const msgH = vi.fn();
    const typH = vi.fn();
    const joinH = vi.fn();
    onMessage(msgH);
    onTyping(typH);
    onParticipantJoined(joinH);

    // Simulate a long call with interleaved events
    for (let i = 0; i < 5; i++) {
      sock._trigger({ event: 'message:new', data: { seq: i } });
    }
    sock._trigger({ event: 'typing:update', data: { userId: 'u2', isTyping: true } });
    sock._trigger({ event: 'call:participant-joined', data: { callId: 'c1', participant: { userId: 'u2' } } });

    expect(msgH).toHaveBeenCalledTimes(5);
    expect(typH).toHaveBeenCalledOnce();
    expect(joinH).toHaveBeenCalledOnce();

    // All handlers still functional — no re-registration needed
    sock._trigger({ event: 'message:new', data: { seq: 99 } });
    expect(msgH).toHaveBeenCalledTimes(6);
  });
});
