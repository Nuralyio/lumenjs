import { describe, it, expect, beforeEach, vi } from 'vitest';
import { connectChat, getSocket, onMessage, disconnect } from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

describe('connectChat()', () => {
  it('always returns the socket — never undefined (regression: old dist returned undefined)', async () => {
    mockIo.mockReturnValue(makeMockSocket());
    const result = await connectChat({ userId: 'u1' });
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });

  it('creates socket with correct namespace, path, and reconnection config', async () => {
    mockIo.mockReturnValue(makeMockSocket());
    await connectChat({ userId: 'u1', conversations: 'c1' });
    const [ns, opts] = mockIo.mock.calls[0];
    expect(ns).toBe('/nk/messages');
    expect(opts.path).toBe('/__nk_socketio/');
    expect(opts.reconnection).toBe(true);
    expect(opts.reconnectionAttempts).toBe(Infinity);
    expect(opts.reconnectionDelay).toBeGreaterThan(0);
  });

  it('serialises params into __params query field', async () => {
    mockIo.mockReturnValue(makeMockSocket());
    await connectChat({ userId: 'abc-123', conversations: 'x,y' });
    const opts = mockIo.mock.calls[0][1];
    const parsed = JSON.parse(opts.query.__params);
    expect(parsed.userId).toBe('abc-123');
    expect(parsed.conversations).toBe('x,y');
  });

  it('works with no params (anonymous connect)', async () => {
    mockIo.mockReturnValue(makeMockSocket());
    await expect(connectChat()).resolves.toBeDefined();
  });

  it('reuses socket when already connected — io() called only once', async () => {
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();
    await connectChat();
    await connectChat();
    expect(mockIo).toHaveBeenCalledOnce();
  });

  it('attaches exactly one nk:data listener (no duplicates)', async () => {
    const sock = makeMockSocket({ connected: true });
    mockIo.mockReturnValue(sock);
    await connectChat();
    await connectChat();
    expect(sock._nkDataListenerCount).toBe(1);
  });

  it('dispatches incoming nk:data events to registered handlers', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();
    const handler = vi.fn();
    onMessage(handler);
    sock._trigger({ event: 'message:new', data: { id: 99 } });
    expect(handler).toHaveBeenCalledWith({ id: 99 });
  });

  it('ignores nk:data with no event field — does not throw', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();
    const handler = vi.fn();
    onMessage(handler);
    expect(() => sock._trigger({} as any)).not.toThrow();
    expect(() => sock._trigger({ event: '', data: {} })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
