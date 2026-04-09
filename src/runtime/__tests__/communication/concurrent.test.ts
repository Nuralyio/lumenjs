/**
 * Concurrent / race condition tests
 *
 * Covers: multiple simultaneous connectChat() calls, _connectingPromise lock,
 * layout+page double-connect scenarios, rapid connect/disconnect cycles.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { connectChat, getSocket, onMessage, disconnect } from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── _connectingPromise lock ──────────────────────────────────────────────────

describe('_connectingPromise lock prevents duplicate socket creation', () => {
  it('calling connectChat() 3× simultaneously creates exactly one socket', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    // All three calls launched before any resolves
    const [r1, r2, r3] = await Promise.all([
      connectChat({ userId: 'u1' }),
      connectChat({ userId: 'u1' }),
      connectChat({ userId: 'u1' }),
    ]);

    expect(mockIo).toHaveBeenCalledOnce();
    expect(r1).toBe(sock);
    expect(r2).toBe(sock);
    expect(r3).toBe(sock);
  });

  it('all concurrent callers receive the same socket instance', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    const sockets = await Promise.all(
      Array.from({ length: 10 }, () => connectChat()),
    );

    const unique = new Set(sockets);
    expect(unique.size).toBe(1);
    expect(mockIo).toHaveBeenCalledOnce();
  });

  it('nk:data listener attached exactly once even with concurrent calls', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    await Promise.all([
      connectChat(),
      connectChat(),
      connectChat(),
      connectChat(),
      connectChat(),
    ]);

    expect(sock._nkDataListenerCount).toBe(1);
  });

  it('handler fires exactly once per event with concurrent-connect sockets', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    await Promise.all([connectChat(), connectChat(), connectChat()]);

    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: 'message:new', data: { id: 1 } });

    // If nk:data was attached multiple times, handler fires N times — the bug
    expect(h).toHaveBeenCalledOnce();
    expect(h).toHaveBeenCalledWith({ id: 1 });
  });
});

// ── Layout + messages page double-connect scenario ───────────────────────────

describe('layout and messages page double-connect (real-world scenario)', () => {
  it('layout calls connectChat first, messages page calls it shortly after — one socket', async () => {
    const sock = makeMockSocket({ connected: false, active: true });
    mockIo.mockReturnValue(sock);

    // Layout initializes first (no await yet in real app — fire-and-forget)
    const layoutPromise = connectChat({ userId: 'user-1', conversations: '' });

    // Messages page initializes before layout's connectChat resolves
    const pagePromise = connectChat({ userId: 'user-1', conversations: 'conv-a,conv-b' });

    const [layoutSock, pageSock] = await Promise.all([layoutPromise, pagePromise]);

    expect(layoutSock).toBe(pageSock);
    expect(mockIo).toHaveBeenCalledOnce();
  });

  it('handlers registered by layout and page both fire on shared socket', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);

    const [layoutSock, pageSock] = await Promise.all([
      connectChat({ userId: 'u1' }),
      connectChat({ userId: 'u1' }),
    ]);

    const layoutBadgeHandler = vi.fn();
    const pageMessageHandler = vi.fn();

    // Layout registers badge refresh handler
    const { onMessage: onMsg } = await import('../../communication.js');
    onMsg(layoutBadgeHandler);
    onMsg(pageMessageHandler);

    sock._trigger({ event: 'message:new', data: { id: 99 } });

    expect(layoutBadgeHandler).toHaveBeenCalledOnce();
    expect(pageMessageHandler).toHaveBeenCalledOnce();
  });

  it('calling connectChat() after socket is connected still returns same socket', async () => {
    const sock = makeMockSocket({ connected: true, active: true });
    mockIo.mockReturnValue(sock);
    await connectChat();

    // Page navigation — another connectChat call on an already-connected socket
    const result = await connectChat({ userId: 'u1', conversations: 'new-conv' });
    expect(result).toBe(sock);
    expect(mockIo).toHaveBeenCalledOnce();
  });
});

// ── Rapid connect/disconnect cycles ─────────────────────────────────────────

describe('rapid connect/disconnect cycles', () => {
  it('10 connect/disconnect cycles — no leaks, correct state each time', async () => {
    for (let i = 0; i < 10; i++) {
      const sock = makeMockSocket();
      mockIo.mockReturnValue(sock);

      const result = await connectChat({ userId: `u${i}` });
      expect(result).toBe(sock);
      expect(getSocket()).toBe(sock);

      disconnect();
      expect(getSocket()).toBeNull();
    }

    expect(mockIo).toHaveBeenCalledTimes(10);
  });

  it('disconnect called before connectChat resolves — aborts in-flight, next connect works', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);

    // Start connect but don't await
    const p = connectChat();
    // Immediately disconnect (simulates unmount before connect completes).
    // _sessionId increments → in-flight async function will detect mismatch and abort.
    disconnect();

    // Await original promise — in-flight aborts, returns null (no socket set)
    await p;

    expect(getSocket()).toBeNull(); // aborted — no socket was set

    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    const result = await connectChat();
    expect(result).toBe(sock2); // fresh connect after abort ✓
  });

  it('old socket cannot reach new-session handlers after disconnect', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();

    const session1Handler = vi.fn(); // registered in session 1
    onMessage(session1Handler);
    disconnect();

    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();

    const session2Handler = vi.fn(); // registered in session 2 (new Map)
    onMessage(session2Handler);

    // Old socket fires: session1Handler fires (same session), session2Handler does NOT
    sock1._trigger({ event: 'message:new', data: { stale: true } });
    expect(session2Handler).not.toHaveBeenCalled(); // new-session handler protected ✓

    // New socket fires: only session2Handler fires
    sock2._trigger({ event: 'message:new', data: { fresh: true } });
    expect(session2Handler).toHaveBeenCalledWith({ fresh: true });
    // session1Handler not in sock2's Map
    expect(session1Handler).toHaveBeenCalledTimes(1); // only from sock1 trigger above
  });
});
