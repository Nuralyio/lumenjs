/**
 * Session isolation tests
 *
 * The core guarantee of the sessionHandlers pattern:
 *   - NEW session handlers (registered after disconnect) are NEVER callable from OLD sockets.
 *   - Old sockets can still fire their own session's handlers (same Map — expected, not a bug).
 *   - disconnect() + _sessionId abort any in-flight connectChat() calls.
 *
 * These tests target specific bugs previously fixed:
 *   Bug A: Without sessionHandlers, old socket held a reference to the `_handlers`
 *          variable. After disconnect(), `_handlers = new Map()` with new-session handlers
 *          was readable by old socket's nk:data listener. Fixed by closure capture.
 *   Bug B: disconnect() during in-flight connectChat() left a dangling socket. Fixed
 *          by _sessionId sentinel that aborts the async function.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectChat,
  setSocket,
  getSocket,
  onMessage,
  onTyping,
  onPresence,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── Core guarantee: NEW session handlers not reachable from OLD sockets ──────

describe('sessionHandlers closure: old socket cannot reach NEW-session handlers', () => {
  it('handler registered AFTER disconnect is not reachable from old socket', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();
    disconnect();

    // New session
    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();
    const newSessionHandler = vi.fn();
    onMessage(newSessionHandler); // goes into NEW Map

    // Old socket fires — its closure holds OLD Map, which is empty after replace
    sock1._trigger({ event: 'message:new', data: { from: 'old' } });
    expect(newSessionHandler).not.toHaveBeenCalled(); // protected ✓
  });

  it('three sessions: each old socket cannot reach later sessions\' handlers', async () => {
    const socks = [makeMockSocket(), makeMockSocket(), makeMockSocket()];
    const handlers = [vi.fn(), vi.fn(), vi.fn()];

    for (let i = 0; i < 3; i++) {
      mockIo.mockReturnValue(socks[i]);
      await connectChat();
      onMessage(handlers[i]);
      if (i < 2) disconnect();
    }

    // sock[0] fires — handlers[1] and handlers[2] must NOT fire (cross-session protection)
    socks[0]._trigger({ event: 'message:new', data: {} });
    expect(handlers[1]).not.toHaveBeenCalled();
    expect(handlers[2]).not.toHaveBeenCalled();

    // sock[1] fires — handlers[2] must NOT fire (cross-session protection)
    socks[1]._trigger({ event: 'message:new', data: {} });
    expect(handlers[2]).not.toHaveBeenCalled();

    // sock[2] fires — only handlers[2] fires (current session)
    socks[2]._trigger({ event: 'message:new', data: { current: true } });
    expect(handlers[2]).toHaveBeenCalledOnce();
    expect(handlers[2]).toHaveBeenCalledWith({ current: true });
  });

  it('all event types isolated: old socket cannot reach new-session handlers of any type', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();
    disconnect();

    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();

    const newMsgH = vi.fn();
    const newTypH = vi.fn();
    const newPresH = vi.fn();
    onMessage(newMsgH);
    onTyping(newTypH);
    onPresence(newPresH);

    // Old socket fires all event types — new-session handlers must not fire
    sock1._trigger({ event: 'message:new', data: {} });
    sock1._trigger({ event: 'typing:update', data: {} });
    sock1._trigger({ event: 'presence:changed', data: {} });

    expect(newMsgH).not.toHaveBeenCalled();
    expect(newTypH).not.toHaveBeenCalled();
    expect(newPresH).not.toHaveBeenCalled();
  });

  it('new handler registered between disconnect and reconnect is not reachable from old socket', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();
    disconnect();

    // Handler registered BETWEEN sessions (before new connectChat)
    const betweenHandler = vi.fn();
    onMessage(betweenHandler); // goes into NEW (post-disconnect) Map

    // Old socket fires — cannot see betweenHandler (it's in new Map)
    sock1._trigger({ event: 'message:new', data: {} });
    expect(betweenHandler).not.toHaveBeenCalled();
  });
});

// ── Clarifying correct behaviour: old socket CAN fire its own session's handlers

describe('expected: old socket fires its own session handlers (same Map)', () => {
  it('handler registered BEFORE disconnect fires when old socket triggers (same session)', async () => {
    // This is CORRECT behaviour: the old socket and the handler share the same
    // session Map (captured by closure). This is not a leak — it's the same session.
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();

    const session1Handler = vi.fn();
    onMessage(session1Handler); // in session-1 Map

    disconnect(); // replaces _handlers with new Map, session1Handler stays in old Map

    // sock1's closure still references session-1 Map → session1Handler fires
    sock1._trigger({ event: 'message:new', data: { expected: true } });
    expect(session1Handler).toHaveBeenCalledWith({ expected: true }); // expected ✓
  });

  it('handlers from disconnect are isolated: new handler in new Map not callable from old socket', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();

    const session1Handler = vi.fn();
    onMessage(session1Handler); // session-1 Map

    disconnect(); // new Map replaces _handlers

    const session2Handler = vi.fn();
    onMessage(session2Handler); // session-2 Map

    sock1._trigger({ event: 'message:new', data: {} });
    expect(session1Handler).toHaveBeenCalled(); // same session — fires ✓
    expect(session2Handler).not.toHaveBeenCalled(); // new session — protected ✓
  });
});

// ── Map replacement (not clear) semantics ────────────────────────────────────

describe('disconnect() replaces Map to prevent cross-session reach', () => {
  it('new socket references new Map: cannot call handlers from old Map', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();

    const oldH = vi.fn();
    onMessage(oldH); // session-1 Map

    disconnect();

    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();

    // sock2 references the NEW Map, which does not have oldH
    sock2._trigger({ event: 'message:new', data: {} });
    expect(oldH).not.toHaveBeenCalled(); // old handler not in new socket's Map ✓
  });

  it('multiple event types: new socket has clean Map', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();

    const s1Msg = vi.fn(), s1Typ = vi.fn(), s1Pres = vi.fn();
    onMessage(s1Msg);
    onTyping(s1Typ);
    onPresence(s1Pres);

    disconnect();

    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();

    // Sock2's Map is empty — no session-1 handlers
    sock2._trigger({ event: 'message:new', data: {} });
    sock2._trigger({ event: 'typing:update', data: {} });
    sock2._trigger({ event: 'presence:changed', data: {} });

    expect(s1Msg).not.toHaveBeenCalled();
    expect(s1Typ).not.toHaveBeenCalled();
    expect(s1Pres).not.toHaveBeenCalled();
  });
});

// ── setSocket() cross-session isolation ──────────────────────────────────────

describe('setSocket() cross-session isolation', () => {
  it('sock1 from before disconnect cannot reach session-2 handlers after setSocket', () => {
    const sock1 = makeMockSocket();
    setSocket(sock1);
    const session1H = vi.fn();
    onMessage(session1H); // session-1 Map

    disconnect(); // new Map

    const sock2 = makeMockSocket();
    setSocket(sock2); // binds to new session Map
    const session2H = vi.fn();
    onMessage(session2H); // session-2 Map

    // sock1 fires: session1H fires (same session), session2H does NOT (cross-session)
    sock1._trigger({ event: 'message:new', data: {} });
    expect(session1H).toHaveBeenCalled();    // same session ✓
    expect(session2H).not.toHaveBeenCalled(); // protected ✓

    // sock2 fires: session2H fires, session1H does NOT (sock2 has new Map)
    session1H.mockClear();
    sock2._trigger({ event: 'message:new', data: {} });
    expect(session2H).toHaveBeenCalled();    // new session handler on new socket ✓
    expect(session1H).not.toHaveBeenCalled(); // not in sock2's Map ✓
  });

  it('swapping sockets with setSocket: both listeners bound to same Map', () => {
    // Both sockets capture the same _handlers Map (no disconnect between setSocket calls)
    const sock1 = makeMockSocket();
    const sock2 = makeMockSocket();
    setSocket(sock1);
    setSocket(sock2); // swap — no disconnect, same Map

    const h = vi.fn();
    onMessage(h);

    sock1._trigger({ event: 'message:new', data: { from: 'sock1' } });
    sock2._trigger({ event: 'message:new', data: { from: 'sock2' } });

    expect(h).toHaveBeenCalledTimes(2);
    expect(h).toHaveBeenNthCalledWith(1, { from: 'sock1' });
    expect(h).toHaveBeenNthCalledWith(2, { from: 'sock2' });
  });
});

// ── _sessionId: in-flight connectChat abandoned on disconnect ────────────────

describe('_sessionId cancels in-flight connectChat when disconnect() is called', () => {
  it('socket created in-flight is abandoned when disconnect() fires during await', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);

    // Start connecting
    const p = connectChat();
    // Immediately disconnect (socket hasn't been created yet — _socket is null)
    disconnect();

    // Await original promise — in-flight async function detects session mismatch
    // and aborts: _socket stays null
    await p;

    // After abort, no socket is set
    expect(getSocket()).toBeNull();
  });

  it('next connectChat after aborted in-flight creates a fresh socket', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);

    const p = connectChat();
    disconnect(); // cancels in-flight
    await p;

    // Fresh connect must work
    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    const result = await connectChat();

    expect(result).toBe(sock2);
    // The abort check fires BEFORE io() is called, so sock1 never calls io().
    // Only sock2's connectChat calls io() — total = 1.
    expect(mockIo).toHaveBeenCalledTimes(1);
  });

  it('handlers registered in new session are NOT reachable from aborted socket', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);

    const p = connectChat();
    disconnect();
    await p;

    // New session
    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();

    const newH = vi.fn();
    onMessage(newH);

    // Sock1 was created but aborted — if its nk:data listener was attached
    // before the abort check, it should still reference the abandoned Map
    sock1._trigger({ event: 'message:new', data: { stale: true } });
    expect(newH).not.toHaveBeenCalled(); // protected ✓
  });

  it('repeated connect/disconnect/connect cycles always produce clean sockets', async () => {
    for (let i = 0; i < 5; i++) {
      const sock = makeMockSocket();
      mockIo.mockReturnValue(sock);
      const result = await connectChat();
      expect(result).toBe(sock);
      disconnect();
      expect(getSocket()).toBeNull();
    }
  });
});

// ── In-flight events at session boundary ─────────────────────────────────────

describe('in-flight events at session boundary', () => {
  it('event dispatched on old socket during disconnect does not crash', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();
    onMessage(vi.fn());

    expect(() => {
      sock._trigger({ event: 'message:new', data: { mid: 1 } });
      disconnect();
      sock._trigger({ event: 'message:new', data: { mid: 2 } });
    }).not.toThrow();
  });

  it('handler registered after connectChat but before events fires correctly', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();

    const h = vi.fn();
    onMessage(h);

    sock._trigger({ event: 'message:new', data: { first: true } });
    expect(h).toHaveBeenCalledWith({ first: true });
  });
});
