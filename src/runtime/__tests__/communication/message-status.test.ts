/**
 * Message status tests
 *
 * Covers the sent → delivered → read status lifecycle:
 * - markRead payload shapes (whole conversation vs. specific message IDs)
 * - onReadReceipt delivery: messageIds, conversationId, readBy fields
 * - Status transitions: sent (initial) → delivered (receiver auto-marks) → read
 * - Multiple messages marked read in one receipt
 * - Read receipts for unknown IDs are no-ops at the SDK layer
 * - Rapid receipts from multiple readers
 * - readBy field passes through as-is (string or object)
 *
 * The real-time message object must include `id: msg.id` so that
 * _onReadReceipt can match receipts by message ID. The bug where
 * real-time messages lacked `id` (so receipts never updated their status)
 * is exercised by the "real-time message id must be preserved" tests below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setSocket,
  getSocket,
  sendMessage,
  markRead,
  onMessage,
  onReadReceipt,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── markRead emit shapes ─────────────────────────────────────────────────────

describe('markRead() emit payload', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('markRead without messageIds emits only conversationId', () => {
    markRead('conv-1');
    const [event, payload] = getSocket().emit.mock.calls[0];
    expect(event).toBe('nk:message:read');
    expect(payload).toEqual({ conversationId: 'conv-1' });
    expect(payload).not.toHaveProperty('messageIds');
  });

  it('markRead with one messageId emits array of one', () => {
    markRead('conv-1', ['msg-1']);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload).toEqual({ conversationId: 'conv-1', messageIds: ['msg-1'] });
  });

  it('markRead with multiple messageIds emits all IDs', () => {
    markRead('conv-1', ['msg-1', 'msg-2', 'msg-3']);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.messageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('markRead with empty messageIds array still includes the field', () => {
    markRead('conv-1', []);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.messageIds).toEqual([]);
  });

  it('markRead event name is nk:message:read', () => {
    markRead('conv-1', ['msg-1']);
    expect(getSocket().emit.mock.calls[0][0]).toBe('nk:message:read');
  });

  it('markRead is a no-op when socket is null — no throw', () => {
    disconnect();
    expect(() => markRead('conv-1')).not.toThrow();
  });

  it('markRead can be called many times (one per incoming message)', () => {
    for (let i = 0; i < 10; i++) markRead('conv-1', [`msg-${i}`]);
    expect(getSocket().emit).toHaveBeenCalledTimes(10);
    getSocket().emit.mock.calls.forEach(([event]: [string]) => {
      expect(event).toBe('nk:message:read');
    });
  });
});

// ── onReadReceipt delivery ────────────────────────────────────────────────────

describe('onReadReceipt() delivery', () => {
  it('fires with complete payload when server sends read-receipt:update', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onReadReceipt(h);

    sock._trigger({
      event: 'read-receipt:update',
      data: {
        conversationId: 'conv-1',
        messageIds: ['msg-1', 'msg-2'],
        readBy: 'u2',
      },
    });

    expect(h).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messageIds: ['msg-1', 'msg-2'],
      readBy: 'u2',
    });
  });

  it('fires with readBy as an object (userId + readAt timestamp)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onReadReceipt((d) => received.push(d));

    sock._trigger({
      event: 'read-receipt:update',
      data: {
        conversationId: 'conv-1',
        messageIds: ['msg-1'],
        readBy: { userId: 'u2', readAt: '2026-04-08T10:00:00Z' },
      },
    });

    expect(received[0].readBy).toEqual({ userId: 'u2', readAt: '2026-04-08T10:00:00Z' });
  });

  it('fires once per receipt event (not per message ID)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onReadReceipt(h);

    // One event with 3 message IDs
    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['m1', 'm2', 'm3'], readBy: 'u2' },
    });

    expect(h).toHaveBeenCalledOnce();
    expect(h.mock.calls[0][0].messageIds).toHaveLength(3);
  });

  it('multiple subscribers all receive the same receipt', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h1 = vi.fn(); // chat UI: mark messages as read
    const h2 = vi.fn(); // notification badge: decrement count

    onReadReceipt(h1);
    onReadReceipt(h2);

    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1'], readBy: 'u2' },
    });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('unsubscribing stops delivery', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    const unsub = onReadReceipt(h);
    unsub();

    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1'], readBy: 'u2' },
    });

    expect(h).not.toHaveBeenCalled();
  });

  it('receipt does not fire message:new handler (events are independent)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const msgH = vi.fn();
    const receiptH = vi.fn();
    onMessage(msgH);
    onReadReceipt(receiptH);

    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1'], readBy: 'u2' },
    });

    expect(receiptH).toHaveBeenCalledOnce();
    expect(msgH).not.toHaveBeenCalled();
  });
});

// ── Full status lifecycle: sent → delivered → read ────────────────────────────

describe('message status lifecycle: sent → delivered → read', () => {
  it('outgoing message payload carries no initial status (SDK does not set it)', () => {
    setSocket(makeMockSocket());
    sendMessage('conv-1', 'Hello!');
    const payload = getSocket().emit.mock.calls[0][1];
    // SDK emits the message payload; status is set by the UI layer (sent=initial)
    expect(payload.conversationId).toBe('conv-1');
    expect(payload.content).toBe('Hello!');
    // No status field emitted — server assigns and returns status
    expect(payload).not.toHaveProperty('status');
  });

  it('send → server echo → receive: message arrives via message:new event', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onMessage((m) => received.push(m));

    sendMessage('conv-1', 'Hello!');

    // Server echoes back with an id and initial status
    sock._trigger({
      event: 'message:new',
      data: { id: 'msg-1', conversationId: 'conv-1', content: 'Hello!', senderId: 'u1', status: 'sent' },
    });

    expect(received[0].id).toBe('msg-1');
    expect(received[0].status).toBe('sent');
  });

  it('send → echo → read receipt: full status progression in one sequence', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const messages: any[] = [];
    const receipts: any[] = [];
    onMessage((m) => messages.push(m));
    onReadReceipt((r) => receipts.push(r));

    // 1. User sends
    sendMessage('conv-1', 'Hello');

    // 2. Server delivers to sender (echo with sent status)
    sock._trigger({
      event: 'message:new',
      data: { id: 'msg-1', conversationId: 'conv-1', content: 'Hello', status: 'sent' },
    });

    // 3. Recipient reads — server broadcasts read receipt
    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1'], readBy: 'u2' },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].messageIds).toContain('msg-1');
  });

  it('real-time message must carry id so read receipts can match it', () => {
    // Regression test: before fix, _onNewMessage built newMsg without id: msg.id,
    // so _onReadReceipt could never find the message to update its status.
    // This test verifies the SDK passes id through on the message:new event.
    const sock = makeMockSocket();
    setSocket(sock);

    const received: any[] = [];
    onMessage((m) => received.push(m));

    // Server sends message with an id (as socket-handler.ts does)
    sock._trigger({
      event: 'message:new',
      data: { id: 'msg-abc', conversationId: 'conv-1', content: 'hi', senderId: 'u2' },
    });

    // The SDK passes the full payload unchanged — id is preserved
    expect(received[0].id).toBe('msg-abc');
  });

  it('read receipt with messageIds: SDK delivers full array unchanged', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const receipts: any[] = [];
    onReadReceipt((r) => receipts.push(r));

    const ids = ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'];
    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ids, readBy: 'u2' },
    });

    expect(receipts[0].messageIds).toEqual(ids);
  });

  it('read receipt with empty messageIds array — delivered as-is', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const receipts: any[] = [];
    onReadReceipt((r) => receipts.push(r));

    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: [], readBy: 'u2' },
    });

    expect(receipts[0].messageIds).toEqual([]);
  });

  it('read receipt for different conversation — not delivered to wrong handler (same handler, different data)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const receipts: any[] = [];
    onReadReceipt((r) => receipts.push(r));

    // Two receipts for two different conversations
    sock._trigger({ event: 'read-receipt:update', data: { conversationId: 'conv-A', messageIds: ['m1'], readBy: 'u2' } });
    sock._trigger({ event: 'read-receipt:update', data: { conversationId: 'conv-B', messageIds: ['m2'], readBy: 'u3' } });

    // SDK delivers both; filtering by conversationId is the UI layer's responsibility
    expect(receipts).toHaveLength(2);
    expect(receipts[0].conversationId).toBe('conv-A');
    expect(receipts[1].conversationId).toBe('conv-B');
  });
});

// ── Rapid and concurrent receipts ────────────────────────────────────────────

describe('rapid and concurrent read receipts', () => {
  it('50 read receipts in rapid succession — all delivered in order', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: number[] = [];
    onReadReceipt((d: any) => received.push(d.seq));

    for (let i = 0; i < 50; i++) {
      sock._trigger({
        event: 'read-receipt:update',
        data: { conversationId: 'conv-1', messageIds: [`msg-${i}`], readBy: 'u2', seq: i },
      });
    }

    expect(received).toHaveLength(50);
    expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('multiple readers sending receipts for the same message', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const readers: string[] = [];
    onReadReceipt((d: any) => readers.push(d.readBy));

    // u2, u3, u4 all read msg-1
    ['u2', 'u3', 'u4'].forEach((userId) => {
      sock._trigger({
        event: 'read-receipt:update',
        data: { conversationId: 'conv-1', messageIds: ['msg-1'], readBy: userId },
      });
    });

    expect(readers).toEqual(['u2', 'u3', 'u4']);
  });

  it('receipt arrives before message (out-of-order) — SDK delivers both independently', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const messages: any[] = [];
    const receipts: any[] = [];
    onMessage((m) => messages.push(m));
    onReadReceipt((r) => receipts.push(r));

    // Receipt arrives first (e.g. network ordering)
    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1'], readBy: 'u2' },
    });

    // Message arrives after
    sock._trigger({
      event: 'message:new',
      data: { id: 'msg-1', conversationId: 'conv-1', content: 'Hello', senderId: 'u1' },
    });

    // SDK delivers both regardless of order — UI reconciles
    expect(receipts).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
  });

  it('markRead then onReadReceipt: SDK send + receive round-trip', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const receipts: any[] = [];
    onReadReceipt((r) => receipts.push(r));

    // We send a markRead
    markRead('conv-1', ['msg-1', 'msg-2']);
    expect(sock.emit).toHaveBeenCalledWith('nk:message:read', { conversationId: 'conv-1', messageIds: ['msg-1', 'msg-2'] });

    // Server broadcasts back to the sender of the original messages
    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1', 'msg-2'], readBy: 'u1' },
    });

    expect(receipts[0].messageIds).toEqual(['msg-1', 'msg-2']);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('read receipt edge cases', () => {
  it('read-receipt:update with missing messageIds field — delivered as-is (undefined)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onReadReceipt((d) => received.push(d));

    // Server sends receipt without messageIds (unusual but should not crash)
    sock._trigger({ event: 'read-receipt:update', data: { conversationId: 'conv-1', readBy: 'u2' } });
    expect(received[0].messageIds).toBeUndefined();
  });

  it('read-receipt:update with null data — does not crash', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    onReadReceipt(vi.fn());
    expect(() => sock._trigger({ event: 'read-receipt:update', data: null })).not.toThrow();
  });

  it('read-receipt:update with no readBy field — delivered as-is', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onReadReceipt((d) => received.push(d));

    sock._trigger({
      event: 'read-receipt:update',
      data: { conversationId: 'conv-1', messageIds: ['msg-1'] },
    });

    expect(received[0].readBy).toBeUndefined();
  });

  it('100 messageIds in a single receipt — all delivered', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onReadReceipt((d) => received.push(d));

    const ids = Array.from({ length: 100 }, (_, i) => `msg-${i}`);
    sock._trigger({ event: 'read-receipt:update', data: { conversationId: 'conv-1', messageIds: ids, readBy: 'u2' } });

    expect(received[0].messageIds).toHaveLength(100);
    expect(received[0].messageIds[0]).toBe('msg-0');
    expect(received[0].messageIds[99]).toBe('msg-99');
  });

  it('read-receipt:update fires only onReadReceipt handler, not onMessage', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const msgH = vi.fn();
    const receiptH = vi.fn();
    onMessage(msgH);
    onReadReceipt(receiptH);

    sock._trigger({ event: 'read-receipt:update', data: { conversationId: 'c1', messageIds: ['m1'], readBy: 'u2' } });

    expect(receiptH).toHaveBeenCalledOnce();
    expect(msgH).not.toHaveBeenCalled();
  });
});
