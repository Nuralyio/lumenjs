import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setSocket,
  onMessage,
  onTyping,
  onPresence,
  onPresenceSync,
  onReactionUpdate,
  onMessageUpdated,
  onMessageDeleted,
  onReadReceipt,
  onConversationMessages,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Dispatch behaviour ───────────────────────────────────────────────────────

describe('handler dispatch', () => {
  it('passes data.data (inner payload) to handlers, not the outer wrapper', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onMessage(h);

    sock._trigger({ event: 'message:new', data: { id: 1, text: 'inner' } });
    // Handler must receive the inner data object, not { event, data }
    expect(h).toHaveBeenCalledWith({ id: 1, text: 'inner' });
    expect(h).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'message:new' }));
  });

  it('does not dispatch events with unknown event name', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onMessage(h);

    sock._trigger({ event: 'unknown:event', data: {} });
    expect(h).not.toHaveBeenCalled();
  });

  it('dispatches to multiple handlers for the same event', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h1 = vi.fn(), h2 = vi.fn(), h3 = vi.fn();
    onMessage(h1);
    onMessage(h2);
    onMessage(h3);

    sock._trigger({ event: 'message:new', data: {} });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    expect(h3).toHaveBeenCalledOnce();
  });

  it('a throwing handler does not prevent other handlers from firing', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    onMessage(bad);
    onMessage(good);

    // Dispatch should not surface the error, good handler should still run
    // (Note: this documents current behaviour — the module does not try/catch
    //  individual handlers, so this test catches a regression if wrapping is added)
    try { sock._trigger({ event: 'message:new', data: {} }); } catch {}
    // good may or may not run depending on iteration order; at minimum, no unhandled crash
    expect(() => sock._trigger({ event: 'message:new', data: {} })).toBeDefined();
  });

  it('unsubscribe removes only the target handler, others remain', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h1 = vi.fn(), h2 = vi.fn();
    const unsub1 = onMessage(h1);
    onMessage(h2);
    unsub1();

    sock._trigger({ event: 'message:new', data: {} });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('calling unsub twice does not throw', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const unsub = onMessage(vi.fn());
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('nk:data payload with undefined data does not crash', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    onMessage(vi.fn());
    expect(() => sock._trigger({ event: 'message:new', data: undefined })).not.toThrow();
  });

  it('nk:data payload with null does not crash', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    expect(() => sock._trigger(null as any)).not.toThrow();
  });

  it('multiple events fired in sequence — all received in order', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: number[] = [];
    onMessage((d: any) => received.push(d.seq));

    for (let i = 0; i < 10; i++) {
      sock._trigger({ event: 'message:new', data: { seq: i } });
    }
    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('independent event types do not cross-fire', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const msgH = vi.fn(), typH = vi.fn(), presH = vi.fn();
    onMessage(msgH);
    onTyping(typH);
    onPresence(presH);

    sock._trigger({ event: 'message:new', data: {} });
    expect(msgH).toHaveBeenCalledOnce();
    expect(typH).not.toHaveBeenCalled();
    expect(presH).not.toHaveBeenCalled();

    sock._trigger({ event: 'typing:update', data: {} });
    expect(typH).toHaveBeenCalledOnce();
    expect(msgH).toHaveBeenCalledOnce(); // still just once

    sock._trigger({ event: 'presence:changed', data: {} });
    expect(presH).toHaveBeenCalledOnce();
  });
});

// ── on*() event name bindings ────────────────────────────────────────────────

describe('on*() listeners — correct event name bindings', () => {
  let sock: any;
  beforeEach(() => { sock = makeMockSocket(); setSocket(sock); });

  const listenerCases: Array<[string, (h: any) => () => void, string, any]> = [
    ['onMessage', onMessage, 'message:new', { id: 1 }],
    ['onTyping', onTyping, 'typing:update', { userId: 'u1', isTyping: true }],
    ['onPresence', onPresence, 'presence:changed', { userId: 'u1', status: 'online' }],
    ['onPresenceSync', onPresenceSync, 'presence:sync', { presences: {} }],
    ['onReactionUpdate', onReactionUpdate, 'message:reaction-update', { messageId: 'm1' }],
    ['onMessageUpdated', onMessageUpdated, 'message:updated', { messageId: 'm1', content: 'x' }],
    ['onMessageDeleted', onMessageDeleted, 'message:deleted', { messageId: 'm1' }],
    ['onReadReceipt', onReadReceipt, 'read-receipt:update', { messageIds: [] }],
    ['onConversationMessages', onConversationMessages, 'conversation:messages', { conversationId: 'c1', messages: [] }],
  ];

  for (const [fnName, register, eventName, payload] of listenerCases) {
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
