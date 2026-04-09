/**
 * Payload edge cases
 *
 * Covers: unusual nk:data shapes (null, array, nested, non-string event),
 * falsy but valid values (sdpMLineIndex=0, duration='0', empty string content),
 * null/undefined optional fields in emit actions, type coercion safety,
 * and special characters in message content.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setSocket,
  getSocket,
  sendMessage,
  markRead,
  hangup,
  sendIceCandidate,
  toggleMedia,
  onMessage,
  onTyping,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Unusual nk:data payloads from the server ─────────────────────────────────

describe('unusual nk:data payloads — SDK resilience', () => {
  let sock: any;
  beforeEach(() => { sock = makeMockSocket(); setSocket(sock); });

  it('null payload → does not crash', () => {
    onMessage(vi.fn());
    expect(() => sock._trigger(null as any)).not.toThrow();
  });

  it('undefined payload → does not crash', () => {
    expect(() => sock._trigger(undefined as any)).not.toThrow();
  });

  it('string payload → does not crash', () => {
    expect(() => sock._trigger('not-an-object' as any)).not.toThrow();
  });

  it('array payload → does not crash', () => {
    expect(() => sock._trigger([] as any)).not.toThrow();
  });

  it('empty object payload → handler not called (no event field)', () => {
    const h = vi.fn();
    onMessage(h);
    sock._trigger({} as any);
    expect(h).not.toHaveBeenCalled();
  });

  it('event field is null → handler not called', () => {
    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: null, data: { id: 1 } } as any);
    expect(h).not.toHaveBeenCalled();
  });

  it('event field is 0 (falsy number) → handler not called', () => {
    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: 0, data: {} } as any);
    expect(h).not.toHaveBeenCalled();
  });

  it('event field is false → handler not called', () => {
    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: false, data: {} } as any);
    expect(h).not.toHaveBeenCalled();
  });

  it('event field is a number (not a valid event name) → no crash, no handler', () => {
    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: 42, data: {} } as any);
    expect(h).not.toHaveBeenCalled();
  });

  it('event field is an object → no crash (Map.get returns undefined)', () => {
    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: {}, data: {} } as any);
    expect(h).not.toHaveBeenCalled();
  });

  it('event is correct but data field is missing (undefined) → handler called with undefined', () => {
    const received: any[] = [];
    onMessage((d) => received.push(d));
    sock._trigger({ event: 'message:new' } as any); // no data field
    expect(received).toHaveLength(1);
    expect(received[0]).toBeUndefined();
  });

  it('data field is an array → passed through as-is to handler', () => {
    const received: any[] = [];
    onMessage((d) => received.push(d));
    sock._trigger({ event: 'message:new', data: [1, 2, 3] });
    expect(received[0]).toEqual([1, 2, 3]);
  });

  it('data field is a primitive (number) → passed through', () => {
    const received: any[] = [];
    onMessage((d) => received.push(d));
    sock._trigger({ event: 'message:new', data: 42 });
    expect(received[0]).toBe(42);
  });

  it('data field is null → passed through as null', () => {
    const received: any[] = [];
    onMessage((d) => received.push(d));
    sock._trigger({ event: 'message:new', data: null });
    expect(received[0]).toBeNull();
  });

  it('deeply nested data object → passed through without modification', () => {
    const deep = { a: { b: { c: { d: { e: 'deep' } } } } };
    const received: any[] = [];
    onMessage((d) => received.push(d));
    sock._trigger({ event: 'message:new', data: deep });
    expect(received[0]).toEqual(deep);
    expect(received[0].a.b.c.d.e).toBe('deep');
  });

  it('very large data payload (10KB object) → passed through', () => {
    const large = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field${i}`, 'x'.repeat(100)])
    );
    const received: any[] = [];
    onMessage((d) => received.push(d));
    sock._trigger({ event: 'message:new', data: large });
    expect(Object.keys(received[0])).toHaveLength(100);
  });
});

// ── Falsy-but-valid values in emit payloads ───────────────────────────────────

describe('falsy-but-valid values in emit payloads', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('sendIceCandidate with sdpMLineIndex=0 (falsy but valid line index)', () => {
    sendIceCandidate('c1', 'u2', 'candidate', 0, 'audio');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.sdpMLineIndex).toBe(0); // 0 is valid, not omitted
  });

  it('sendIceCandidate with sdpMLineIndex=null (explicitly null)', () => {
    sendIceCandidate('c1', 'u2', 'candidate', null, null);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.sdpMLineIndex).toBeNull();
    expect(payload.sdpMid).toBeNull();
  });

  it('hangup with duration="0" (falsy string) — duration should be included', () => {
    // '0' is truthy → duration IS included
    hangup('c1', 'completed', '0');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.duration).toBe('0');
  });

  it('hangup with duration=null → duration key omitted', () => {
    hangup('c1', 'completed', null);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload).not.toHaveProperty('duration');
  });

  it('hangup with duration=undefined → duration key omitted', () => {
    hangup('c1', 'completed', undefined);
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload).not.toHaveProperty('duration');
  });

  it('hangup with duration="" (empty string) → falsy, duration omitted', () => {
    hangup('c1', 'completed', '');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload).not.toHaveProperty('duration');
  });

  it('toggleMedia with audio=false (falsy bool) — field IS included', () => {
    toggleMedia('c1', { audio: false });
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload).toHaveProperty('audio');
    expect(payload.audio).toBe(false);
  });

  it('toggleMedia with video=false — field included', () => {
    toggleMedia('c1', { video: false });
    expect(getSocket().emit.mock.calls[0][1].video).toBe(false);
  });

  it('markRead with empty string conversationId — emits as-is (SDK does not validate)', () => {
    markRead('');
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: '' });
  });

  it('sendMessage with empty string content — emits as-is', () => {
    sendMessage('c1', '');
    const payload = getSocket().emit.mock.calls[0][1];
    expect(payload.content).toBe('');
  });
});

// ── Special characters and unicode ───────────────────────────────────────────

describe('special characters and unicode in payloads', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('message content with emoji', () => {
    sendMessage('c1', '🔥💯✨🎉');
    expect(getSocket().emit.mock.calls[0][1].content).toBe('🔥💯✨🎉');
  });

  it('message content with newlines and tabs', () => {
    sendMessage('c1', 'line1\nline2\ttabbed');
    expect(getSocket().emit.mock.calls[0][1].content).toBe('line1\nline2\ttabbed');
  });

  it('message content with HTML entities — not escaped by SDK', () => {
    sendMessage('c1', '<script>alert(1)</script>');
    expect(getSocket().emit.mock.calls[0][1].content).toBe('<script>alert(1)</script>');
  });

  it('message content with quotes and backslashes', () => {
    sendMessage('c1', '"quoted" and \\backslash\\');
    expect(getSocket().emit.mock.calls[0][1].content).toBe('"quoted" and \\backslash\\');
  });

  it('message content with unicode combining characters', () => {
    const content = 'caf\u00e9'; // café
    sendMessage('c1', content);
    expect(getSocket().emit.mock.calls[0][1].content).toBe(content);
  });

  it('conversationId with hyphens and underscores (UUID-like)', () => {
    sendMessage('550e8400-e29b-41d4-a716-446655440000', 'hi');
    expect(getSocket().emit.mock.calls[0][1].conversationId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('received message with unicode content — passed through unchanged', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onMessage((d) => received.push(d));

    const arabic = 'مرحبا بالعالم';
    const japanese = 'こんにちは世界';
    sock._trigger({ event: 'message:new', data: { content: arabic + japanese } });
    expect(received[0].content).toBe(arabic + japanese);
  });

  it('nk:data event name with unusual-but-valid format fires correct handler', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    // SDK only knows about specific event names. Unknown ones just don't match.
    const unknownH = vi.fn();
    const knownH = vi.fn();
    onMessage(knownH); // 'message:new'

    sock._trigger({ event: 'message:new:extra', data: {} }); // not registered
    expect(knownH).not.toHaveBeenCalled();

    sock._trigger({ event: 'message:new', data: {} }); // exact match
    expect(knownH).toHaveBeenCalledOnce();
  });
});

// ── Typing event edge cases ───────────────────────────────────────────────────

describe('typing event edge cases', () => {
  it('onTyping receives isTyping=false (stop typing)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onTyping(h);

    sock._trigger({ event: 'typing:update', data: { userId: 'u1', conversationId: 'c1', isTyping: false } });
    expect(h).toHaveBeenCalledWith({ userId: 'u1', conversationId: 'c1', isTyping: false });
  });

  it('typing event with missing userId — passed through as-is', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onTyping((d) => received.push(d));

    sock._trigger({ event: 'typing:update', data: { conversationId: 'c1', isTyping: true } });
    expect(received[0].userId).toBeUndefined();
    expect(received[0].isTyping).toBe(true);
  });

  it('rapid typing start/stop bursts — all events delivered', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const events: boolean[] = [];
    onTyping((d: any) => events.push(d.isTyping));

    for (let i = 0; i < 20; i++) {
      sock._trigger({ event: 'typing:update', data: { isTyping: i % 2 === 0 } });
    }
    expect(events).toHaveLength(20);
    expect(events[0]).toBe(true);
    expect(events[1]).toBe(false);
  });
});
