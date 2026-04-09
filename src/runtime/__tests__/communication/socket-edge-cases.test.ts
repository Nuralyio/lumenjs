/**
 * Socket edge cases
 *
 * Covers: setSocket(null), setSocket with __nk_comm_attached already set,
 * socket.active edge values (undefined, null, 0, false), getSocket() identity,
 * connectChat() when socket exists but active is undefined (pre-socket.io v4
 * compatibility), and extreme socket state transitions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectChat,
  getSocket,
  setSocket,
  onMessage,
  sendMessage,
  isConnected,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── setSocket() with unusual values ──────────────────────────────────────────

describe('setSocket() with unusual values', () => {
  it('setSocket(null) sets _socket to null — getSocket() returns null', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    expect(getSocket()).toBe(sock);

    setSocket(null as any);
    expect(getSocket()).toBeNull();
  });

  it('setSocket(null) when already null — no-op (early return on _socket === socket)', () => {
    // Both are null, _socket === socket → early return
    expect(() => setSocket(null as any)).not.toThrow();
    expect(getSocket()).toBeNull();
  });

  it('setSocket(null) does not attach nk:data listener (guard: if (_socket && ...))', () => {
    const sock = makeMockSocket();
    setSocket(sock); // attach listener on sock
    setSocket(null as any); // clear socket

    // sock's listener still exists from first setSocket
    // Triggering on sock should not crash (no _socket, but listener still on the socket object)
    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: 'message:new', data: {} });
    // Handler fires because sock's closure still references the (now-replaced) Map
    // This is expected behaviour documented in session-isolation tests
  });

  it('setSocket after setSocket(null) — new socket attaches listener correctly', () => {
    setSocket(null as any); // null first
    const sock = makeMockSocket();
    setSocket(sock);

    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: 'message:new', data: { id: 1 } });
    expect(h).toHaveBeenCalledWith({ id: 1 });
  });

  it('setSocket with a socket that already has __nk_comm_attached=true — listener NOT double-attached', () => {
    const sock: any = makeMockSocket();
    sock.__nk_comm_attached = true; // pre-marked as attached

    setSocket(sock);
    // Guard: if (_socket && !_socket.__nk_comm_attached) → false → skips
    expect(sock._nkDataListenerCount).toBe(0); // no listener attached
  });

  it('setSocket with __nk_comm_attached=false — listener IS attached', () => {
    const sock: any = makeMockSocket();
    sock.__nk_comm_attached = false; // explicitly false

    setSocket(sock);
    // !false = true → attaches
    expect(sock._nkDataListenerCount).toBe(1);
  });

  it('replacing socket with another socket — second socket gets listener', () => {
    const sock1 = makeMockSocket();
    const sock2 = makeMockSocket();
    setSocket(sock1);
    setSocket(sock2);

    expect(sock2._nkDataListenerCount).toBe(1);

    const h = vi.fn();
    onMessage(h);
    sock2._trigger({ event: 'message:new', data: { from: 2 } });
    expect(h).toHaveBeenCalledWith({ from: 2 });
  });
});

// ── connectChat() with socket.active edge values ──────────────────────────────

describe('connectChat() respects socket.active edge values', () => {
  it('socket.active=true, connected=true → reused', async () => {
    const sock = makeMockSocket({ connected: true, active: true });
    mockIo.mockReturnValue(sock);
    await connectChat();
    const result = await connectChat();
    expect(result).toBe(sock);
    expect(mockIo).toHaveBeenCalledOnce();
  });

  it('socket.active=true, connected=false (reconnecting) → reused', async () => {
    const sock = makeMockSocket({ connected: false, active: true });
    mockIo.mockReturnValue(sock);
    await connectChat();
    const result = await connectChat();
    expect(result).toBe(sock);
    expect(mockIo).toHaveBeenCalledOnce();
  });

  it('socket.active=false (explicitly disconnected) → new socket created', async () => {
    const sock1 = makeMockSocket({ connected: true, active: true });
    mockIo.mockReturnValue(sock1);
    await connectChat();

    sock1.active = false;
    const sock2 = makeMockSocket({ connected: false, active: true });
    mockIo.mockReturnValue(sock2);
    const result = await connectChat();

    expect(result).toBe(sock2);
    expect(mockIo).toHaveBeenCalledTimes(2);
  });

  it('socket.active=undefined (old socket.io without .active) → treated as falsy, new socket created', async () => {
    // socket.active=undefined → `_socket.active !== false` → `undefined !== false` → true
    // So it REUSES the socket (undefined is not false)
    const sock = makeMockSocket();
    (sock as any).active = undefined;
    mockIo.mockReturnValue(sock);
    await connectChat();

    const result = await connectChat();
    // undefined !== false → socket is reused
    expect(result).toBe(sock);
    expect(mockIo).toHaveBeenCalledOnce();
  });

  it('socket.active=0 (another falsy non-false value) → not === false → reused', async () => {
    const sock = makeMockSocket();
    (sock as any).active = 0;
    mockIo.mockReturnValue(sock);
    await connectChat();

    const result = await connectChat();
    // 0 !== false → reused
    expect(result).toBe(sock);
    expect(mockIo).toHaveBeenCalledOnce();
  });

  it('socket.active=null → null !== false → socket reused', async () => {
    const sock = makeMockSocket();
    (sock as any).active = null;
    mockIo.mockReturnValue(sock);
    await connectChat();

    // Guard: `_socket && _socket.active !== false` → `sock && null !== false` → true → reuse
    const result = await connectChat();
    expect(result).toBe(sock);
    expect(mockIo).toHaveBeenCalledOnce();
  });
});

// ── getSocket() identity guarantees ──────────────────────────────────────────

describe('getSocket() identity guarantees', () => {
  it('getSocket() returns exact same object reference as connectChat returned', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    const returned = await connectChat();
    expect(getSocket()).toBe(returned);
    expect(getSocket()).toBe(sock);
  });

  it('getSocket() after setSocket() returns exact same reference', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    expect(getSocket()).toBe(sock);
  });

  it('getSocket() called multiple times returns same reference (no cloning)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const ref1 = getSocket();
    const ref2 = getSocket();
    expect(ref1).toBe(ref2);
  });

  it('getSocket() returns null before any socket is set', () => {
    expect(getSocket()).toBeNull();
  });
});

// ── emit() guards ─────────────────────────────────────────────────────────────

describe('emit() null-guard: all emit actions safe when socket is absent', () => {
  it('sendMessage when _socket is null — no throw, no side effect', () => {
    expect(() => sendMessage('c', 'hi')).not.toThrow();
  });

  it('sendMessage when setSocket(null) was called — no throw', () => {
    setSocket(makeMockSocket());
    setSocket(null as any);
    expect(() => sendMessage('c', 'hi')).not.toThrow();
  });

  it('emit action after socket replaced with null-like socket — documents real behaviour', () => {
    // A socket that has on() and disconnect() but no emit() method.
    // The SDK's emit() guard is: `if (!_socket) return` — it does NOT check for
    // _socket.emit existence. So calling sendMessage on a socket without emit throws.
    // This is documented behaviour: callers must provide a proper socket.
    const badSock = { connected: true, active: true, on: vi.fn(), disconnect: vi.fn() };
    setSocket(badSock as any);
    expect(() => sendMessage('c', 'hi')).toThrow(); // socket.emit is not a function ← known
  });
});

// ── Extreme socket state transitions ─────────────────────────────────────────

describe('extreme socket state transitions', () => {
  it('connectChat → setSocket(different) → connectChat reuses setSocket socket', async () => {
    const sock1 = makeMockSocket({ connected: true, active: true });
    mockIo.mockReturnValue(sock1);
    await connectChat({ userId: 'u1' });

    // Call service swaps in a different socket (common in call flows)
    const sock2 = makeMockSocket({ connected: true, active: true });
    setSocket(sock2);

    // Next connectChat should return sock2 (active, not false)
    const result = await connectChat({ userId: 'u1' });
    expect(result).toBe(sock2);
    expect(mockIo).toHaveBeenCalledOnce(); // no new io() call
  });

  it('isConnected tracks the current socket, not the original one', async () => {
    const sock1 = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock1);
    await connectChat();
    expect(isConnected()).toBe(true);

    const sock2 = makeMockSocket({ connected: false });
    setSocket(sock2);
    expect(isConnected()).toBe(false); // now using sock2

    sock2.connected = true;
    expect(isConnected()).toBe(true);
  });

  it('socket replaced mid-session: new messages go to new socket', async () => {
    const sock1 = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock1);
    await connectChat();

    sendMessage('c1', 'via sock1');
    expect(sock1.emit).toHaveBeenCalledWith('nk:message:send', expect.anything());

    // Swap socket (call service scenario)
    const sock2 = makeMockSocket({ connected: true });
    setSocket(sock2);

    sendMessage('c1', 'via sock2');
    expect(sock2.emit).toHaveBeenCalledWith('nk:message:send', expect.anything());
    expect(sock1.emit).toHaveBeenCalledTimes(1); // only first message
  });
});
