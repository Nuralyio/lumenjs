/**
 * Message lifecycle tests
 *
 * Covers the full journey of a message from send to delete:
 * send → receive → react → edit → read receipt → delete.
 * Also covers: reply-to chains, encrypted messages, attachment types,
 * onMessageUpdated, onMessageDeleted, onReactionUpdate, onReadReceipt.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setSocket,
  getSocket,
  sendMessage,
  markRead,
  reactToMessage,
  editMessage,
  deleteMessage,
  onMessage,
  onMessageUpdated,
  onMessageDeleted,
  onReactionUpdate,
  onReadReceipt,
  onConversationMessages,
  loadMessages,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Full send → receive lifecycle ────────────────────────────────────────────

describe('send → receive message lifecycle', () => {
  it('sends a text message and receives it back from the server', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const received: any[] = [];
    onMessage((m) => received.push(m));

    // User sends
    sendMessage('conv-1', 'Hello world');

    // Server echoes back (or another user's message arrives)
    sock._trigger({
      event: 'message:new',
      data: { id: 'msg-1', conversationId: 'conv-1', content: 'Hello world', senderId: 'u1' },
    });

    expect(sock.emit).toHaveBeenCalledWith('nk:message:send', expect.objectContaining({
      conversationId: 'conv-1',
      content: 'Hello world',
    }));
    expect(received[0]).toMatchObject({ id: 'msg-1', content: 'Hello world' });
  });

  it('reply-to message: replyTo field sent and received correctly', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const replyTo = { id: 'msg-0', content: 'original', senderId: 'u2' };
    sendMessage('conv-1', 'my reply', { replyTo });

    const payload = sock.emit.mock.calls[0][1];
    expect(payload.replyTo).toEqual(replyTo);
    expect(payload.content).toBe('my reply');
  });

  it('image message: attachment included, type is "image"', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const att = { id: 'att-1', url: '/uploads/photo.jpg', type: 'image', size: 102400 };
    sendMessage('conv-1', '', { type: 'image', attachment: att });

    const payload = sock.emit.mock.calls[0][1];
    expect(payload.type).toBe('image');
    expect(payload.attachment).toEqual(att);
    expect(payload.content).toBe('');
  });

  it('audio message: type is "audio" with attachment', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const att = { id: 'att-2', url: '/uploads/voice.ogg', type: 'audio', size: 51200 };
    sendMessage('conv-1', '', { type: 'audio', attachment: att });

    const payload = sock.emit.mock.calls[0][1];
    expect(payload.type).toBe('audio');
    expect(payload.attachment).toEqual(att);
  });

  it('encrypted message: encrypted flag set', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    sendMessage('conv-1', 'secret', { encrypted: true });
    expect(sock.emit.mock.calls[0][1].encrypted).toBe(true);
  });

  it('rapid burst of messages: all arrive in order', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const received: number[] = [];
    onMessage((m: any) => received.push(m.seq));

    for (let i = 0; i < 50; i++) {
      sock._trigger({ event: 'message:new', data: { seq: i } });
    }

    expect(received).toHaveLength(50);
    expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

// ── Read receipts ────────────────────────────────────────────────────────────

describe('read receipts', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('markRead without messageIds marks entire conversation', () => {
    markRead('conv-1');
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: 'conv-1' });
  });

  it('markRead with specific message IDs', () => {
    markRead('conv-1', ['msg-1', 'msg-2', 'msg-3']);
    expect(getSocket().emit.mock.calls[0][1]).toEqual({
      conversationId: 'conv-1',
      messageIds: ['msg-1', 'msg-2', 'msg-3'],
    });
  });

  it('onReadReceipt fires when server sends read-receipt:update', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onReadReceipt(h);

    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1'], readBy: 'u2' },
    });

    expect(h).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messageIds: ['msg-1'],
      readBy: 'u2',
    });
  });

  it('multiple read receipts from different users all delivered', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const receipts: string[] = [];
    onReadReceipt((d: any) => receipts.push(d.readBy));

    sock._trigger({ event: 'read-receipt:update', data: { readBy: 'u2', messageIds: ['m1'] } });
    sock._trigger({ event: 'read-receipt:update', data: { readBy: 'u3', messageIds: ['m1'] } });
    sock._trigger({ event: 'read-receipt:update', data: { readBy: 'u4', messageIds: ['m1'] } });

    expect(receipts).toEqual(['u2', 'u3', 'u4']);
  });

  it('markRead called immediately after receiving message (typical flow)', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    onMessage((_msg: any) => {
      // Auto-mark read when message is received
      markRead('conv-1', [_msg.id]);
    });

    sock._trigger({ event: 'message:new', data: { id: 'msg-42', content: 'hi' } });

    const markReadEmit = sock.emit.mock.calls.find(([e]: [string]) => e === 'nk:message:read');
    expect(markReadEmit).toBeDefined();
    expect(markReadEmit![1].messageIds).toEqual(['msg-42']);
  });
});

// ── Message reactions ────────────────────────────────────────────────────────

describe('message reactions', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('reactToMessage emits with emoji preserved', () => {
    reactToMessage('msg-1', 'conv-1', '👍');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.messageId).toBe('msg-1');
    expect(payload.conversationId).toBe('conv-1');
    expect(payload.emoji).toBe('👍');
  });

  it('different emoji characters all transmitted correctly', () => {
    const emojis = ['❤️', '😂', '😮', '😢', '😡', '🔥', '💯', '✅'];
    emojis.forEach((emoji, i) => {
      reactToMessage(`msg-${i}`, 'conv-1', emoji);
    });

    const emits = getSocket().emit.mock.calls;
    emojis.forEach((emoji, i) => {
      expect(emits[i][1].emoji).toBe(emoji);
    });
  });

  it('onReactionUpdate fires when a user reacts', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onReactionUpdate(h);

    sock._trigger({
      event: 'message:reaction-update',
      data: { messageId: 'msg-1', reactions: [{ emoji: '👍', count: 2, users: ['u1', 'u2'] }] },
    });

    expect(h).toHaveBeenCalledWith({
      messageId: 'msg-1',
      reactions: [{ emoji: '👍', count: 2, users: ['u1', 'u2'] }],
    });
  });

  it('multiple users reacting to same message — all updates received', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const updates: any[] = [];
    onReactionUpdate((d) => updates.push(d));

    sock._trigger({ event: 'message:reaction-update', data: { messageId: 'm1', reactions: [{ emoji: '👍', count: 1 }] } });
    sock._trigger({ event: 'message:reaction-update', data: { messageId: 'm1', reactions: [{ emoji: '❤️', count: 1 }] } });

    expect(updates).toHaveLength(2);
    expect(updates[0].reactions[0].emoji).toBe('👍');
    expect(updates[1].reactions[0].emoji).toBe('❤️');
  });

  it('toggle reaction: reacting twice with same emoji (toggle off)', () => {
    // Server-side handles toggle, SDK just sends the emit both times
    reactToMessage('msg-1', 'conv-1', '👍'); // add
    reactToMessage('msg-1', 'conv-1', '👍'); // remove (toggle)
    expect(getSocket().emit).toHaveBeenCalledTimes(2);
    expect(getSocket().emit.mock.calls[0][1].emoji).toBe('👍');
    expect(getSocket().emit.mock.calls[1][1].emoji).toBe('👍');
  });
});

// ── Message edit lifecycle ───────────────────────────────────────────────────

describe('message edit lifecycle', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('editMessage emits nk:message:edit with all fields', () => {
    editMessage('msg-1', 'conv-1', 'corrected content');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:message:edit');
    expect(payload).toEqual({ messageId: 'msg-1', conversationId: 'conv-1', content: 'corrected content' });
  });

  it('onMessageUpdated fires when server broadcasts edit', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onMessageUpdated(h);

    sock._trigger({
      event: 'message:updated',
      data: { messageId: 'msg-1', content: 'corrected', updatedAt: '2026-04-08T10:00:00Z' },
    });

    expect(h).toHaveBeenCalledWith({ messageId: 'msg-1', content: 'corrected', updatedAt: '2026-04-08T10:00:00Z' });
  });

  it('edit followed by another edit — both updates received in order', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const contents: string[] = [];
    onMessageUpdated((d: any) => contents.push(d.content));

    sock._trigger({ event: 'message:updated', data: { messageId: 'm1', content: 'v2', updatedAt: 't1' } });
    sock._trigger({ event: 'message:updated', data: { messageId: 'm1', content: 'v3', updatedAt: 't2' } });

    expect(contents).toEqual(['v2', 'v3']);
  });
});

// ── Message deletion lifecycle ───────────────────────────────────────────────

describe('message deletion lifecycle', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('deleteMessage emits nk:message:delete with messageId and conversationId', () => {
    deleteMessage('msg-1', 'conv-1');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:message:delete');
    expect(payload).toEqual({ messageId: 'msg-1', conversationId: 'conv-1' });
  });

  it('onMessageDeleted fires when server broadcasts deletion', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onMessageDeleted(h);

    sock._trigger({
      event: 'message:deleted',
      data: { messageId: 'msg-1', conversationId: 'conv-1' },
    });

    expect(h).toHaveBeenCalledWith({ messageId: 'msg-1', conversationId: 'conv-1' });
  });

  it('multiple deletions from different users — all delivered', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const deleted: string[] = [];
    onMessageDeleted((d: any) => deleted.push(d.messageId));

    sock._trigger({ event: 'message:deleted', data: { messageId: 'msg-1', conversationId: 'c1' } });
    sock._trigger({ event: 'message:deleted', data: { messageId: 'msg-2', conversationId: 'c1' } });
    sock._trigger({ event: 'message:deleted', data: { messageId: 'msg-3', conversationId: 'c2' } });

    expect(deleted).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('full message lifecycle: send → react → edit → delete', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const msgH = vi.fn(), reactH = vi.fn(), editH = vi.fn(), deleteH = vi.fn();
    onMessage(msgH);
    onReactionUpdate(reactH);
    onMessageUpdated(editH);
    onMessageDeleted(deleteH);

    // 1. Message arrives
    sock._trigger({ event: 'message:new', data: { id: 'msg-1', content: 'Hello!' } });
    // 2. User reacts
    sock._trigger({ event: 'message:reaction-update', data: { messageId: 'msg-1', reactions: [{ emoji: '👍' }] } });
    // 3. Sender edits
    sock._trigger({ event: 'message:updated', data: { messageId: 'msg-1', content: 'Hello (edited)' } });
    // 4. Sender deletes
    sock._trigger({ event: 'message:deleted', data: { messageId: 'msg-1', conversationId: 'c1' } });

    expect(msgH).toHaveBeenCalledOnce();
    expect(reactH).toHaveBeenCalledOnce();
    expect(editH).toHaveBeenCalledOnce();
    expect(deleteH).toHaveBeenCalledOnce();
  });
});

// ── Lazy-load conversation messages ─────────────────────────────────────────

describe('loadMessages + onConversationMessages (lazy load)', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('loadMessages emits nk:conversation:load-messages with conversationId', () => {
    loadMessages('conv-42');
    expect(getSocket().emit.mock.calls[0]).toEqual(['nk:conversation:load-messages', { conversationId: 'conv-42' }]);
  });

  it('onConversationMessages fires when server responds with message batch', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onConversationMessages(h);

    const msgs = [
      { id: 'm1', content: 'first', senderId: 'u1' },
      { id: 'm2', content: 'second', senderId: 'u2' },
    ];

    sock._trigger({
      event: 'conversation:messages',
      data: { conversationId: 'conv-1', messages: msgs, participants: [{ userId: 'u1' }, { userId: 'u2' }] },
    });

    expect(h).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messages: msgs,
      participants: [{ userId: 'u1' }, { userId: 'u2' }],
    });
  });

  it('loadMessages for multiple conversations — separate response events per conversation', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const responses: string[] = [];
    onConversationMessages((d: any) => responses.push(d.conversationId));

    loadMessages('conv-1');
    loadMessages('conv-2');

    sock._trigger({ event: 'conversation:messages', data: { conversationId: 'conv-1', messages: [], participants: [] } });
    sock._trigger({ event: 'conversation:messages', data: { conversationId: 'conv-2', messages: [], participants: [] } });

    expect(responses).toEqual(['conv-1', 'conv-2']);
  });

  it('empty messages array is delivered correctly (no messages in conversation)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onConversationMessages(h);

    sock._trigger({ event: 'conversation:messages', data: { conversationId: 'c1', messages: [], participants: [] } });
    expect(h).toHaveBeenCalledWith({ conversationId: 'c1', messages: [], participants: [] });
  });
});
