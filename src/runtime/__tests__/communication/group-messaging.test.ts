/**
 * Group messaging tests
 *
 * Covers: multi-conversation connections, group typing, group message routing,
 * joinConversation/leaveConversation, multiple subscribers on the same event,
 * and conversation-specific payload validation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectChat,
  getSocket,
  setSocket,
  onMessage,
  onTyping,
  joinConversation,
  leaveConversation,
  sendMessage,
  startTyping,
  stopTyping,
  markRead,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Multi-conversation connection params ─────────────────────────────────────

describe('connecting with multiple conversations', () => {
  it('passes comma-separated conversation IDs in __params', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    await connectChat({ userId: 'u1', conversations: 'conv-1,conv-2,conv-3' });

    const opts = mockIo.mock.calls[0][1];
    const params = JSON.parse(opts.query.__params);
    expect(params.conversations).toBe('conv-1,conv-2,conv-3');
    expect(params.userId).toBe('u1');
  });

  it('connects without conversations param (browse without open conversation)', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    await connectChat({ userId: 'u1', conversations: '' });

    const opts = mockIo.mock.calls[0][1];
    const params = JSON.parse(opts.query.__params);
    expect(params.conversations).toBe('');
  });

  it('connects with single conversation ID', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    await connectChat({ userId: 'u1', conversations: 'conv-42' });

    const opts = mockIo.mock.calls[0][1];
    const params = JSON.parse(opts.query.__params);
    expect(params.conversations).toBe('conv-42');
  });
});

// ── SDK does no conversation-level filtering ─────────────────────────────────

describe('SDK delivers all messages regardless of conversationId (app filters)', () => {
  it('onMessage handler receives messages from all conversations', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const received: any[] = [];
    onMessage((msg) => received.push(msg));

    sock._trigger({ event: 'message:new', data: { conversationId: 'conv-1', text: 'a' } });
    sock._trigger({ event: 'message:new', data: { conversationId: 'conv-2', text: 'b' } });
    sock._trigger({ event: 'message:new', data: { conversationId: 'conv-3', text: 'c' } });

    expect(received).toHaveLength(3);
    expect(received[0].conversationId).toBe('conv-1');
    expect(received[1].conversationId).toBe('conv-2');
    expect(received[2].conversationId).toBe('conv-3');
  });

  it('onTyping handler receives typing events from all conversations', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const received: any[] = [];
    onTyping((d) => received.push(d));

    sock._trigger({ event: 'typing:update', data: { conversationId: 'conv-1', userId: 'u2', isTyping: true } });
    sock._trigger({ event: 'typing:update', data: { conversationId: 'conv-2', userId: 'u3', isTyping: true } });

    expect(received).toHaveLength(2);
  });
});

// ── Multiple subscribers (badge + UI + notification) ────────────────────────

describe('multiple subscribers on the same event (real-world multi-consumer)', () => {
  it('chat UI, badge counter, and notification handler all receive new message', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const chatUI = vi.fn();      // renders the message bubble
    const badgeCounter = vi.fn(); // increments unread badge
    const notifHandler = vi.fn(); // shows push notification

    onMessage(chatUI);
    onMessage(badgeCounter);
    onMessage(notifHandler);

    sock._trigger({ event: 'message:new', data: { id: 1, text: 'hello group' } });

    expect(chatUI).toHaveBeenCalledWith({ id: 1, text: 'hello group' });
    expect(badgeCounter).toHaveBeenCalledWith({ id: 1, text: 'hello group' });
    expect(notifHandler).toHaveBeenCalledWith({ id: 1, text: 'hello group' });
  });

  it('unsubscribing one consumer does not affect others', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const chatUI = vi.fn();
    const badgeCounter = vi.fn();
    const unsubBadge = onMessage(badgeCounter);
    onMessage(chatUI);

    // Badge counter navigates away → unsubscribes
    unsubBadge();

    sock._trigger({ event: 'message:new', data: { id: 2 } });

    expect(chatUI).toHaveBeenCalledOnce();
    expect(badgeCounter).not.toHaveBeenCalled();
  });

  it('rapid re-subscribe: unsubscribe + re-register works correctly', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const h = vi.fn();
    const unsub1 = onMessage(h);
    unsub1();

    // Same handler re-registered (e.g. page re-mounted)
    onMessage(h);

    sock._trigger({ event: 'message:new', data: { id: 3 } });
    expect(h).toHaveBeenCalledOnce(); // not twice
  });
});

// ── Group typing indicators ───────────────────────────────────────────────────

describe('group typing indicators', () => {
  it('typing in one conversation does not suppress other conversation handlers', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const typingEvents: any[] = [];
    onTyping((d) => typingEvents.push(d));

    // 3 people typing in different conversations simultaneously
    sock._trigger({ event: 'typing:update', data: { conversationId: 'group-1', userId: 'u2', isTyping: true } });
    sock._trigger({ event: 'typing:update', data: { conversationId: 'group-1', userId: 'u3', isTyping: true } });
    sock._trigger({ event: 'typing:update', data: { conversationId: 'direct-4', userId: 'u5', isTyping: true } });

    expect(typingEvents).toHaveLength(3);
    expect(typingEvents[0].conversationId).toBe('group-1');
    expect(typingEvents[2].conversationId).toBe('direct-4');
  });

  it('own typing indicator: startTyping sends correct conversationId', () => {
    setSocket(makeMockSocket());

    startTyping('conv-group-99');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.conversationId).toBe('conv-group-99');
  });

  it('stopTyping sends correct conversationId', () => {
    setSocket(makeMockSocket());

    stopTyping('conv-group-99');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.conversationId).toBe('conv-group-99');
  });
});

// ── joinConversation / leaveConversation ─────────────────────────────────────

describe('joinConversation() and leaveConversation()', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('joinConversation emits nk:conversation:join with conversationId', () => {
    joinConversation('room-abc');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:conversation:join');
    expect(payload).toEqual({ conversationId: 'room-abc' });
  });

  it('leaveConversation emits nk:conversation:leave with conversationId', () => {
    leaveConversation('room-abc');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:conversation:leave');
    expect(payload).toEqual({ conversationId: 'room-abc' });
  });

  it('can join multiple conversations sequentially', () => {
    joinConversation('conv-1');
    joinConversation('conv-2');
    joinConversation('conv-3');

    const calls = getSocket().emit.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][1]).toEqual({ conversationId: 'conv-1' });
    expect(calls[1][1]).toEqual({ conversationId: 'conv-2' });
    expect(calls[2][1]).toEqual({ conversationId: 'conv-3' });
  });

  it('can leave all conversations', () => {
    leaveConversation('conv-1');
    leaveConversation('conv-2');

    const calls = getSocket().emit.mock.calls;
    expect(calls[0][0]).toBe('nk:conversation:leave');
    expect(calls[1][0]).toBe('nk:conversation:leave');
  });

  it('join then leave sequence is correct', () => {
    joinConversation('conv-x');
    leaveConversation('conv-x');

    const calls = getSocket().emit.mock.calls;
    expect(calls[0][0]).toBe('nk:conversation:join');
    expect(calls[1][0]).toBe('nk:conversation:leave');
    expect(calls[0][1].conversationId).toBe('conv-x');
    expect(calls[1][1].conversationId).toBe('conv-x');
  });
});

// ── Message sending in group conversations ───────────────────────────────────

describe('sending messages in group conversations', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('sendMessage correctly targets a group conversation by ID', () => {
    sendMessage('group-conv-888', 'Hello group!');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.conversationId).toBe('group-conv-888');
    expect(payload.content).toBe('Hello group!');
  });

  it('multiple messages to different conversations are emitted independently', () => {
    sendMessage('conv-a', 'msg to A');
    sendMessage('conv-b', 'msg to B');
    sendMessage('conv-c', 'msg to C');

    const calls = getSocket().emit.mock.calls;
    expect(calls[0][1].conversationId).toBe('conv-a');
    expect(calls[1][1].conversationId).toBe('conv-b');
    expect(calls[2][1].conversationId).toBe('conv-c');
  });

  it('markRead with specific messageIds for group conversation', () => {
    markRead('group-conv-1', ['msg-1', 'msg-2', 'msg-3']);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.conversationId).toBe('group-conv-1');
    expect(payload.messageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });
});

// ── Incoming group messages ───────────────────────────────────────────────────

describe('receiving group messages', () => {
  it('group message with senderName and groupId fields passed through as-is', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const received: any[] = [];
    onMessage((msg) => received.push(msg));

    sock._trigger({
      event: 'message:new',
      data: {
        id: 'msg-99',
        conversationId: 'group-conv-1',
        senderId: 'u3',
        senderName: 'Charlie',
        content: 'Group message content',
        type: 'text',
        createdAt: '2026-04-08T10:00:00Z',
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].senderId).toBe('u3');
    expect(received[0].senderName).toBe('Charlie');
    expect(received[0].conversationId).toBe('group-conv-1');
  });

  it('burst of group messages all delivered in order', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const received: number[] = [];
    onMessage((msg: any) => received.push(msg.seq));

    for (let i = 0; i < 20; i++) {
      sock._trigger({ event: 'message:new', data: { seq: i, conversationId: 'group-1' } });
    }

    expect(received).toHaveLength(20);
    expect(received).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});

// ── connectChat after joining a call in a group (socket reuse) ───────────────

describe('connectChat after call already started in group', () => {
  it('connectChat reuses socket if call service already set an active socket', async () => {
    // Call service sets a socket (via setSocket) when a call starts
    const callSock = makeMockSocket({ connected: true, active: true });
    setSocket(callSock);

    // Messages page calls connectChat — must reuse callSock, not create new
    const result = await connectChat({ userId: 'u1', conversations: 'group-1' });

    expect(result).toBe(callSock);
    expect(mockIo).not.toHaveBeenCalled(); // no new socket created
  });

  it('messages page handler works on call-service socket after connectChat', async () => {
    const callSock = makeMockSocket({ connected: true, active: true });
    setSocket(callSock);

    await connectChat({ userId: 'u1', conversations: 'group-1' });

    const msgHandler = vi.fn();
    onMessage(msgHandler);

    callSock._trigger({ event: 'message:new', data: { id: 1 } });
    expect(msgHandler).toHaveBeenCalledWith({ id: 1 });
  });
});
