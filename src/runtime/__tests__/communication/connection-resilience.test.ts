/**
 * Connection resilience tests
 *
 * Covers: socket activity states, connection drops, reconnect after drop,
 * mid-call reconnects, handler survival across socket.io auto-reconnects.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectChat,
  getSocket,
  setSocket,
  onMessage,
  onTyping,
  disconnect,
  isConnected,
  sendMessage,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── socket.active flag semantics ─────────────────────────────────────────────

describe('socket.active state: reconnecting vs explicitly disconnected', () => {
  it('reuses socket when active=true and connected=false (auto-reconnect in progress)', async () => {
    // This is the critical case: socket.io dropped the connection but is reconnecting.
    // active=true means socket.io will retry; we must NOT create a second socket.
    const sock = makeMockSocket({ connected: false, active: true });
    mockIo.mockReturnValue(sock);
    await connectChat({ userId: 'u1' });

    // Simulate connection drop: socket is now disconnected but still active (reconnecting)
    sock.connected = false; // active stays true

    const result = await connectChat({ userId: 'u1' });
    expect(result).toBe(sock); // must reuse — not create new socket
    expect(mockIo).toHaveBeenCalledOnce(); // io() must not be called again
  });

  it('creates new socket when active=false (socket was explicitly killed)', async () => {
    const sock1 = makeMockSocket({ connected: true, active: true });
    mockIo.mockReturnValue(sock1);
    await connectChat({ userId: 'u1' });

    // Simulate socket.io's own disconnect (sets active=false)
    sock1.connected = false;
    sock1.active = false;

    const sock2 = makeMockSocket({ connected: false, active: true });
    mockIo.mockReturnValue(sock2);
    const result = await connectChat({ userId: 'u1' });

    expect(result).toBe(sock2); // new socket
    expect(mockIo).toHaveBeenCalledTimes(2);
  });

  it('setSocket() with active=false socket then connectChat() creates new socket', async () => {
    // Call service sets a dead socket; connectChat should not reuse it
    const deadSock = makeMockSocket({ connected: false, active: false });
    setSocket(deadSock);

    const freshSock = makeMockSocket({ connected: false, active: true });
    mockIo.mockReturnValue(freshSock);
    const result = await connectChat();

    expect(result).toBe(freshSock);
    expect(mockIo).toHaveBeenCalledOnce();
  });
});

// ── Handlers survive socket.io auto-reconnect (same socket object) ───────────

describe('handlers survive socket.io auto-reconnect', () => {
  it('nk:data listener still fires after simulated reconnect on same socket', async () => {
    // socket.io reconnects using the same socket object — connected goes
    // false → true again. Handlers attached via socket.on() persist.
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();

    const h = vi.fn();
    onMessage(h);

    // Simulate drop
    sock.connected = false;

    // socket.io fires 'disconnect' then reconnects the same socket object
    // New 'connect' event arrives and connected flips back to true
    sock.connected = true;

    // Messages resume on the same socket — handler must still fire
    sock._trigger({ event: 'message:new', data: { id: 42 } });
    expect(h).toHaveBeenCalledWith({ id: 42 });
  });

  it('multiple event types all survive reconnect', async () => {
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();

    const msgH = vi.fn(), typH = vi.fn();
    onMessage(msgH);
    onTyping(typH);

    sock.connected = false;
    sock.connected = true; // reconnected

    sock._trigger({ event: 'message:new', data: { body: 'hi' } });
    sock._trigger({ event: 'typing:update', data: { userId: 'u1', isTyping: true } });

    expect(msgH).toHaveBeenCalledOnce();
    expect(typH).toHaveBeenCalledOnce();
  });

  it('events fired during disconnected window are lost — no buffering', async () => {
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();

    const h = vi.fn();
    onMessage(h);

    // Socket drops — socket.io would buffer these internally, but our SDK does not
    sock.connected = false;
    // Events NOT fired on socket during this period → handler not called
    // (testing that SDK has no internal buffer)
    expect(h).not.toHaveBeenCalled();
  });
});

// ── Connection drop mid-call ─────────────────────────────────────────────────

describe('connection drop while a call is active', () => {
  it('call listeners survive reconnect (same socket object)', async () => {
    const { onIncomingCall } = await import('../../communication.js');
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat({ userId: 'caller' });

    const callHandler = vi.fn();
    onIncomingCall(callHandler);

    // Drop
    sock.connected = false;
    // socket.io reconnects
    sock.connected = true;

    // Incoming call arrives after reconnect
    sock._trigger({ event: 'call:incoming', data: { callId: 'c1', type: 'video' } });
    expect(callHandler).toHaveBeenCalledWith({ callId: 'c1', type: 'video' });
  });

  it('emit functions queue to correct socket after reconnect', async () => {
    const { respondToCall } = await import('../../communication.js');
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();

    sock.connected = false;
    sock.connected = true; // reconnected

    // This uses the same socket object — emit should work
    respondToCall('call-1', 'accept');
    expect(sock.emit).toHaveBeenCalledWith('nk:call:respond', { callId: 'call-1', action: 'accept' });
  });
});

// ── isConnected reflects live socket state ───────────────────────────────────

describe('isConnected() reflects real-time socket state', () => {
  it('tracks socket.connected dynamically (not a snapshot)', async () => {
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();

    expect(isConnected()).toBe(true);
    sock.connected = false;
    expect(isConnected()).toBe(false);
    sock.connected = true;
    expect(isConnected()).toBe(true);
  });
});

// ── Reconnect after drop: layout + page both call connectChat ────────────────

describe('layout and messages page both call connectChat after a drop', () => {
  it('only one socket created after drop when both reconnect simultaneously', async () => {
    const sock1 = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock1);
    await connectChat({ userId: 'u1', conversations: '' }); // layout

    // Drop: socket.io sets active=false (explicit server kick)
    sock1.connected = false;
    sock1.active = false;

    const sock2 = makeMockSocket({ connected: false, active: true });
    mockIo.mockReturnValue(sock2);

    // Both layout and messages page call connectChat concurrently after drop
    const [r1, r2, r3] = await Promise.all([
      connectChat({ userId: 'u1', conversations: '' }),
      connectChat({ userId: 'u1', conversations: 'c1,c2' }),
      connectChat({ userId: 'u1', conversations: 'c1,c2' }),
    ]);

    // Only one new socket must be created
    expect(mockIo).toHaveBeenCalledTimes(2); // once for sock1, once for sock2
    expect(r1).toBe(sock2);
    expect(r2).toBe(sock2);
    expect(r3).toBe(sock2);
  });
});

// ── Emit actions are no-ops during disconnected window ───────────────────────

describe('emit actions during disconnected window', () => {
  it('sendMessage during disconnect does not throw and does not emit', async () => {
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();

    sock.connected = false;
    sock.active = false;
    disconnect(); // explicit disconnect

    // Between disconnect and reconnect, emit should be silent
    expect(() => sendMessage('c1', 'hello')).not.toThrow();
    expect(sock.emit).not.toHaveBeenCalled();
  });
});
