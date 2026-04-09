import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSocket,
  setSocket,
  markRead,
  reactToMessage,
  updatePresence,
  refreshBadge,
  loadMessages,
  startTyping,
  stopTyping,
  requestPresenceSync,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── markRead payload ─────────────────────────────────────────────────────────

describe('markRead() payload', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('sends only conversationId when no messageIds', () => {
    markRead('c1');
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: 'c1' });
  });

  it('sends messageIds when provided', () => {
    markRead('c1', ['m1', 'm2']);
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: 'c1', messageIds: ['m1', 'm2'] });
  });

  it('sends empty array when explicitly passed []', () => {
    markRead('c1', []);
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: 'c1', messageIds: [] });
  });
});

// ── Other payload shapes ─────────────────────────────────────────────────────

describe('payload correctness', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('reactToMessage sends emoji without modification', () => {
    reactToMessage('msg-1', 'c1', '🔥');
    expect(getSocket().emit.mock.calls[0][1].emoji).toBe('🔥');
  });

  it('requestPresenceSync sends full userIds array', () => {
    requestPresenceSync(['u1', 'u2', 'u3']);
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ userIds: ['u1', 'u2', 'u3'] });
  });

  it('updatePresence sends status string', () => {
    updatePresence('away');
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ status: 'away' });
  });

  it('refreshBadge sends empty object payload', () => {
    refreshBadge();
    expect(getSocket().emit.mock.calls[0][1]).toEqual({});
  });

  it('loadMessages sends conversationId', () => {
    loadMessages('conv-abc');
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: 'conv-abc' });
  });

  it('startTyping sends conversationId', () => {
    startTyping('conv-abc');
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: 'conv-abc' });
  });

  it('stopTyping sends conversationId', () => {
    stopTyping('conv-abc');
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ conversationId: 'conv-abc' });
  });
});
