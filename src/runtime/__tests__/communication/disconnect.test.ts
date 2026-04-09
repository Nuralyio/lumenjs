import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectChat,
  getSocket,
  onMessage,
  sendMessage,
  markRead,
  startTyping,
  stopTyping,
  loadMessages,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── disconnect lifecycle ─────────────────────────────────────────────────────

describe('disconnect()', () => {
  it('calls socket.disconnect()', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();
    disconnect();
    expect(sock.disconnect).toHaveBeenCalledOnce();
  });

  it('sets getSocket() to null', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();
    disconnect();
    expect(getSocket()).toBeNull();
  });

  it('clears all registered handlers', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();
    const h = vi.fn();
    onMessage(h);
    disconnect();

    // Reconnect and fire an event — the old handler must NOT fire
    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();
    sock2._trigger({ event: 'message:new', data: {} });
    expect(h).not.toHaveBeenCalled();
  });

  it('is a no-op when called with no socket — does not throw', () => {
    expect(() => disconnect()).not.toThrow();
  });

  it('can be called multiple times without throwing', async () => {
    const sock = makeMockSocket();
    mockIo.mockReturnValue(sock);
    await connectChat();
    disconnect();
    expect(() => disconnect()).not.toThrow();
    expect(() => disconnect()).not.toThrow();
  });

  it('after disconnect, emit actions are silent no-ops', () => {
    disconnect();
    expect(() => {
      sendMessage('c1', 'hi');
      markRead('c1');
      startTyping('c1');
      stopTyping('c1');
      loadMessages('c1');
    }).not.toThrow();
  });
});

// ── Reconnect after disconnect ───────────────────────────────────────────────

describe('reconnect after disconnect', () => {
  it('new socket works correctly after disconnect + reconnect', async () => {
    // First session
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat({ userId: 'u1' });
    const oldH = vi.fn();
    onMessage(oldH);
    disconnect();

    // Second session
    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat({ userId: 'u1' });
    const newH = vi.fn();
    onMessage(newH);

    sock2._trigger({ event: 'message:new', data: { fresh: true } });
    expect(newH).toHaveBeenCalledWith({ fresh: true });
    expect(oldH).not.toHaveBeenCalled(); // old handler cleared on disconnect
  });

  it('io() is called again after disconnect (creates new socket)', async () => {
    mockIo.mockReturnValue(makeMockSocket());
    await connectChat();
    disconnect();
    mockIo.mockReturnValue(makeMockSocket());
    await connectChat();
    expect(mockIo).toHaveBeenCalledTimes(2);
  });

  it('handlers registered after reconnect do not receive events from old socket', async () => {
    const sock1 = makeMockSocket();
    mockIo.mockReturnValue(sock1);
    await connectChat();
    disconnect();

    const sock2 = makeMockSocket();
    mockIo.mockReturnValue(sock2);
    await connectChat();
    const h = vi.fn();
    onMessage(h);

    // Fire on old socket — must not reach new handler
    sock1._trigger({ event: 'message:new', data: { stale: true } });
    expect(h).not.toHaveBeenCalled();

    // Fire on new socket — must reach handler
    sock2._trigger({ event: 'message:new', data: { fresh: true } });
    expect(h).toHaveBeenCalledWith({ fresh: true });
  });
});
