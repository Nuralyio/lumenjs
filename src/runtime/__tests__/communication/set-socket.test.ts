import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSocket, setSocket, isConnected, onMessage, disconnect } from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

describe('setSocket()', () => {
  it('makes the socket retrievable via getSocket()', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    expect(getSocket()).toBe(sock);
  });

  it('attaches nk:data listener so events reach handlers', () => {
    const sock = makeMockSocket();
    const h = vi.fn();
    onMessage(h);
    setSocket(sock);
    sock._trigger({ event: 'message:new', data: { id: 1 } });
    expect(h).toHaveBeenCalledWith({ id: 1 });
  });

  it('is idempotent: calling twice with same socket does NOT double-attach', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    setSocket(sock);
    expect(sock._nkDataListenerCount).toBe(1);

    const h = vi.fn();
    onMessage(h);
    sock._trigger({ event: 'message:new', data: {} });
    // If double-attached, handler fires twice — that's the bug
    expect(h).toHaveBeenCalledOnce();
  });

  it('no-ops when called with the same socket that is already set', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const before = sock._nkDataListenerCount;
    setSocket(sock);
    expect(sock._nkDataListenerCount).toBe(before);
  });

  it('handlers registered before setSocket still fire after setSocket', () => {
    const h = vi.fn();
    onMessage(h); // registered first, before any socket
    const sock = makeMockSocket();
    setSocket(sock);
    sock._trigger({ event: 'message:new', data: { pre: true } });
    expect(h).toHaveBeenCalledWith({ pre: true });
  });

  it('swapping to a new socket: events on new socket reach handlers', () => {
    const sock1 = makeMockSocket();
    const sock2 = makeMockSocket();
    setSocket(sock1);
    setSocket(sock2);

    const h = vi.fn();
    onMessage(h);
    sock2._trigger({ event: 'message:new', data: { from: 'sock2' } });
    expect(h).toHaveBeenCalledWith({ from: 'sock2' });
  });
});

describe('isConnected()', () => {
  it('false when no socket', () => { expect(isConnected()).toBe(false); });

  it('false when socket.connected is false', () => {
    setSocket(makeMockSocket({ connected: false }));
    expect(isConnected()).toBe(false);
  });

  it('true when socket.connected is true', () => {
    setSocket(makeMockSocket({ connected: true }));
    expect(isConnected()).toBe(true);
  });

  it('false after disconnect()', async () => {
    mockIo.mockReturnValue(makeMockSocket({ connected: true }));
    const { connectChat } = await import('../../communication.js');
    await connectChat();
    disconnect();
    expect(isConnected()).toBe(false);
  });
});
