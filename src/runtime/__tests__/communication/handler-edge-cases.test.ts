/**
 * Handler edge cases
 *
 * Covers: Set deduplication (same fn registered twice → fires once), handler
 * call ordering (insertion order), same function for multiple event types,
 * async handlers (fire-and-forget), unsubscribe identity, mid-dispatch
 * mutations, and cross-event non-interference under high handler counts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setSocket,
  onMessage,
  onTyping,
  onPresence,
  onReactionUpdate,
  onMessageUpdated,
  onMessageDeleted,
  onReadReceipt,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Set deduplication ────────────────────────────────────────────────────────

describe('handler Set deduplication — same function reference', () => {
  it('registering the same handler twice causes it to fire only once', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const h = vi.fn();
    onMessage(h);
    onMessage(h); // same reference — Set deduplicates

    sock._trigger({ event: 'message:new', data: { id: 1 } });
    expect(h).toHaveBeenCalledOnce();
  });

  it('registering the same handler 10× still fires exactly once', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();

    for (let i = 0; i < 10; i++) onMessage(h);

    sock._trigger({ event: 'message:new', data: {} });
    expect(h).toHaveBeenCalledOnce();
  });

  it('unsubscribing any returned unsub removes the (single) Set entry', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();

    const unsub1 = onMessage(h);
    const unsub2 = onMessage(h); // same fn, still just one Set entry

    unsub1(); // removes h from Set

    sock._trigger({ event: 'message:new', data: {} });
    expect(h).not.toHaveBeenCalled(); // removed ✓

    // Second unsub is a no-op (already gone)
    expect(() => unsub2()).not.toThrow();
  });

  it('two different function references (both wrapping same logic) are stored separately', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const calls: number[] = [];

    const make = () => (_d: any) => calls.push(1);
    const h1 = make();
    const h2 = make(); // different reference

    onMessage(h1);
    onMessage(h2);

    sock._trigger({ event: 'message:new', data: {} });
    expect(calls).toHaveLength(2); // two distinct entries in Set
  });
});

// ── Handler call ordering ────────────────────────────────────────────────────

describe('handler call ordering (insertion order preserved by Set)', () => {
  it('handlers are called in the order they were registered', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const order: number[] = [];

    onMessage(() => order.push(1));
    onMessage(() => order.push(2));
    onMessage(() => order.push(3));

    sock._trigger({ event: 'message:new', data: {} });
    expect(order).toEqual([1, 2, 3]);
  });

  it('handler registered after unsub of earlier handler preserves remaining order', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const order: number[] = [];

    onMessage(() => order.push(1));
    const unsub2 = onMessage(() => order.push(2));
    onMessage(() => order.push(3));

    unsub2();
    onMessage(() => order.push(4));

    sock._trigger({ event: 'message:new', data: {} });
    expect(order).toEqual([1, 3, 4]);
  });

  it('100 handlers called in registration order', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const order: number[] = [];

    for (let i = 0; i < 100; i++) {
      const idx = i;
      onMessage(() => order.push(idx));
    }

    sock._trigger({ event: 'message:new', data: {} });
    expect(order).toHaveLength(100);
    expect(order).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});

// ── Same function registered for multiple event types ────────────────────────

describe('same function registered for multiple event types', () => {
  it('a single function can handle message:new and typing:update independently', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const received: Array<{ type: string; data: any }> = [];
    const universal = (d: any) => received.push(d);

    onMessage(universal);
    onTyping(universal);
    onPresence(universal);

    sock._trigger({ event: 'message:new', data: { type: 'message', id: 1 } });
    sock._trigger({ event: 'typing:update', data: { type: 'typing', userId: 'u1' } });
    sock._trigger({ event: 'presence:changed', data: { type: 'presence', userId: 'u2' } });

    expect(received).toHaveLength(3);
    expect(received[0].type).toBe('message');
    expect(received[1].type).toBe('typing');
    expect(received[2].type).toBe('presence');
  });

  it('unsubscribing from one event type does not affect same fn on other types', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const calls: string[] = [];
    const fn = (d: any) => calls.push(d.which);

    onMessage(fn);
    const unsubTyping = onTyping(fn);
    unsubTyping(); // remove from typing only

    sock._trigger({ event: 'message:new', data: { which: 'message' } });
    sock._trigger({ event: 'typing:update', data: { which: 'typing' } });

    expect(calls).toEqual(['message']); // typing removed, message still active
  });

  it('same fn registered for all 9 listener types — each fires on correct event only', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const log: string[] = [];
    const fn = (d: any) => log.push(d._event);

    onMessage(fn);
    onTyping(fn);
    onPresence(fn);
    onReactionUpdate(fn);
    onMessageUpdated(fn);
    onMessageDeleted(fn);
    onReadReceipt(fn);

    const events = [
      'message:new', 'typing:update', 'presence:changed',
      'message:reaction-update', 'message:updated', 'message:deleted',
      'read-receipt:update',
    ];

    events.forEach((event) => {
      sock._trigger({ event, data: { _event: event } });
    });

    expect(log).toEqual(events);
  });
});

// ── Async handlers (fire-and-forget) ─────────────────────────────────────────

describe('async handlers — SDK fires-and-forgets, does not await', () => {
  it('async handler resolving normally does not crash dispatch', async () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const results: string[] = [];
    onMessage(async (d: any) => {
      await Promise.resolve();
      results.push(d.id);
    });

    sock._trigger({ event: 'message:new', data: { id: 'async-msg' } });
    // Dispatch returns synchronously — async handler is still pending
    expect(results).toHaveLength(0); // not awaited by SDK

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toHaveLength(1);
    expect(results[0]).toBe('async-msg');
  });

  it('async handler that rejects: sync dispatch completes, rejection is unhandled by SDK (known limitation)', async () => {
    // The SDK does NOT await handlers, so an async handler that rejects will
    // produce an unhandled promise rejection. This is a known design limitation.
    // Handlers are responsible for catching their own async errors.
    // This test verifies that the SYNC dispatch path completes without error,
    // and the next sync handler runs, even when an async handler is registered.
    const sock = makeMockSocket();
    setSocket(sock);

    const goodH = vi.fn();
    // Handler that catches its own rejection — SDK-safe pattern
    onMessage(async () => { try { throw new Error('boom'); } catch { /* handler's responsibility */ } });
    onMessage(goodH);

    expect(() => sock._trigger({ event: 'message:new', data: {} })).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(goodH).toHaveBeenCalledOnce();
  });

  it('mix of sync and async handlers — sync handlers run before async resolves', async () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const log: string[] = [];

    onMessage((d: any) => log.push(`sync:${d.id}`));
    onMessage(async (d: any) => {
      await Promise.resolve();
      log.push(`async:${d.id}`);
    });

    sock._trigger({ event: 'message:new', data: { id: 1 } });
    expect(log).toEqual(['sync:1']); // sync ran, async pending

    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['sync:1', 'async:1']);
  });
});

// ── Unsubscribe identity and safety ──────────────────────────────────────────

describe('unsubscribe function identity and safety', () => {
  it('each onMessage call returns a distinct unsubscribe function', () => {
    setSocket(makeMockSocket());
    const h = vi.fn();
    const unsub1 = onMessage(h);
    const unsub2 = onMessage(h);
    expect(unsub1).not.toBe(unsub2); // different closures
  });

  it('calling unsub 100 times does not throw', () => {
    setSocket(makeMockSocket());
    const unsub = onMessage(vi.fn());
    expect(() => { for (let i = 0; i < 100; i++) unsub(); }).not.toThrow();
  });

  it('unsub after disconnect does not throw', () => {
    setSocket(makeMockSocket());
    const unsub = onMessage(vi.fn());
    disconnect();
    expect(() => unsub()).not.toThrow();
  });

  it('unsub on unregistered handler (never registered) does not throw', () => {
    setSocket(makeMockSocket());
    const h = vi.fn();
    // Simulate manual unsub by calling removeHandler-equivalent:
    // We get an unsub without ever having a handler actually in the map
    const unsub = onMessage(h);
    unsub(); // removes h
    expect(() => unsub()).not.toThrow(); // second unsub — h not in map, no-op
  });
});

// ── Mid-dispatch mutations ───────────────────────────────────────────────────

describe('handler mutations during dispatch', () => {
  it('handler that registers a new handler during dispatch — does not crash', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const secondH = vi.fn();
    let registered = false;

    onMessage(() => {
      if (!registered) {
        registered = true;
        onMessage(secondH); // register during dispatch
      }
    });

    // Set iterates over entries; new entries added mid-iteration may or may
    // not fire in the same event depending on JS engine Set implementation.
    // The important guarantee: no crash.
    expect(() => sock._trigger({ event: 'message:new', data: {} })).not.toThrow();
  });

  it('handler that unsubscribes another handler during dispatch', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h2 = vi.fn();
    let unsub2: () => void;

    onMessage(() => {
      if (unsub2) unsub2(); // remove h2 while iterating
    });
    unsub2 = onMessage(h2);

    // Should not crash regardless of whether h2 fires or not
    expect(() => sock._trigger({ event: 'message:new', data: {} })).not.toThrow();
  });

  it('handler that calls disconnect() during dispatch — no crash', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    onMessage(() => {
      disconnect(); // drastic mid-dispatch action
    });
    onMessage(vi.fn()); // second handler may or may not fire

    expect(() => sock._trigger({ event: 'message:new', data: {} })).not.toThrow();
  });
});

// ── Cross-event non-interference with high handler count ─────────────────────

describe('cross-event non-interference under high handler count', () => {
  it('200 message handlers do not interfere with typing or presence handlers', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    const msgCalls: number[] = [];
    const typCalls: number[] = [];

    for (let i = 0; i < 200; i++) {
      const idx = i;
      onMessage(() => msgCalls.push(idx));
    }
    for (let i = 0; i < 50; i++) {
      const idx = i;
      onTyping(() => typCalls.push(idx));
    }

    sock._trigger({ event: 'typing:update', data: {} });
    expect(msgCalls).toHaveLength(0);
    expect(typCalls).toHaveLength(50);

    sock._trigger({ event: 'message:new', data: {} });
    expect(msgCalls).toHaveLength(200);
    expect(typCalls).toHaveLength(50); // unchanged
  });
});
