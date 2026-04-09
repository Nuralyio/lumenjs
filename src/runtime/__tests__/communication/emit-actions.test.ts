import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSocket,
  setSocket,
  sendMessage,
  markRead,
  reactToMessage,
  editMessage,
  deleteMessage,
  loadMessages,
  joinConversation,
  leaveConversation,
  startTyping,
  stopTyping,
  updatePresence,
  requestPresenceSync,
  refreshBadge,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── sendMessage ──────────────────────────────────────────────────────────────

describe('sendMessage()', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('type field is the string "text", NOT a serialised opts object (regression)', () => {
    // Bug: old dist used sendMessage(convId, content, type='text') and callers
    // passed an opts object, which got saved to DB as '{"type":"text"}'.
    sendMessage('c1', 'hello', { type: 'text' });
    const payload = getSocket().emit.mock.calls[0][1];
    expect(typeof payload.type).toBe('string');
    expect(payload.type).toBe('text');
    expect(payload.type).not.toContain('{'); // not serialised object
  });

  it('emits on event nk:message:send', () => {
    sendMessage('c1', 'hi');
    expect(getSocket().emit.mock.calls[0][0]).toBe('nk:message:send');
  });

  it('includes conversationId and content', () => {
    sendMessage('conv-99', 'my text');
    const p = getSocket().emit.mock.calls[0][1];
    expect(p.conversationId).toBe('conv-99');
    expect(p.content).toBe('my text');
  });

  it('defaults type to "text" when opts is undefined', () => {
    sendMessage('c1', 'hi');
    expect(getSocket().emit.mock.calls[0][1].type).toBe('text');
  });

  it('defaults type to "text" when opts.type is omitted', () => {
    sendMessage('c1', 'hi', {});
    expect(getSocket().emit.mock.calls[0][1].type).toBe('text');
  });

  it('respects custom type (e.g. "image")', () => {
    sendMessage('c1', '', { type: 'image', attachment: { url: 'x', type: 'image' } });
    expect(getSocket().emit.mock.calls[0][1].type).toBe('image');
  });

  it('includes attachment when provided', () => {
    const att = { url: 'http://x', type: 'image' };
    sendMessage('c1', '', { attachment: att });
    expect(getSocket().emit.mock.calls[0][1].attachment).toEqual(att);
  });

  it('omits attachment key entirely when not provided', () => {
    sendMessage('c1', 'hi');
    expect(getSocket().emit.mock.calls[0][1]).not.toHaveProperty('attachment');
  });

  it('includes replyTo when provided', () => {
    sendMessage('c1', 'ok', { replyTo: { id: 7, text: 'original' } });
    expect(getSocket().emit.mock.calls[0][1].replyTo).toEqual({ id: 7, text: 'original' });
  });

  it('omits replyTo key when not provided', () => {
    sendMessage('c1', 'hi');
    expect(getSocket().emit.mock.calls[0][1]).not.toHaveProperty('replyTo');
  });

  it('sets encrypted: true when opt is true', () => {
    sendMessage('c1', 'secret', { encrypted: true });
    expect(getSocket().emit.mock.calls[0][1].encrypted).toBe(true);
  });

  it('omits encrypted key when false', () => {
    sendMessage('c1', 'plain', { encrypted: false });
    expect(getSocket().emit.mock.calls[0][1]).not.toHaveProperty('encrypted');
  });

  it('is a silent no-op when socket is null — does not throw', () => {
    disconnect();
    expect(() => sendMessage('c1', 'hi')).not.toThrow();
  });

  it('emits exactly once per call', () => {
    sendMessage('c1', 'a');
    sendMessage('c1', 'b');
    expect(getSocket().emit).toHaveBeenCalledTimes(2);
  });
});

// ── Other emit actions ───────────────────────────────────────────────────────

describe('emit action — correct event names and silent when disconnected', () => {
  const cases: Array<[string, () => void, string]> = [
    ['markRead', () => markRead('c1'), 'nk:message:read'],
    ['reactToMessage', () => reactToMessage('m1', 'c1', '❤️'), 'nk:message:react'],
    ['editMessage', () => editMessage('m1', 'c1', 'new'), 'nk:message:edit'],
    ['deleteMessage', () => deleteMessage('m1', 'c1'), 'nk:message:delete'],
    ['loadMessages', () => loadMessages('c1'), 'nk:conversation:load-messages'],
    ['joinConversation', () => joinConversation('c1'), 'nk:conversation:join'],
    ['leaveConversation', () => leaveConversation('c1'), 'nk:conversation:leave'],
    ['startTyping', () => startTyping('c1'), 'nk:typing:start'],
    ['stopTyping', () => stopTyping('c1'), 'nk:typing:stop'],
    ['updatePresence', () => updatePresence('online'), 'nk:presence:update'],
    ['requestPresenceSync', () => requestPresenceSync(['u1', 'u2']), 'nk:presence:sync'],
    ['refreshBadge', () => refreshBadge(), 'nk:badge:refresh'],
  ];

  for (const [name, action, expectedEvent] of cases) {
    it(`${name}() emits ${expectedEvent}`, () => {
      setSocket(makeMockSocket());
      action();
      expect(getSocket().emit.mock.calls[0][0]).toBe(expectedEvent);
    });

    it(`${name}() is a no-op when socket is null — does not throw`, () => {
      // no socket set — disconnect() already called in beforeEach
      expect(() => action()).not.toThrow();
    });
  }
});
