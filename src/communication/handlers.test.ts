import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationStore } from './store.js';
import {
  handleConversationJoin,
  handleConversationLeave,
  handleMessageSend,
  handleMessageRead,
  handleMessageReact,
  handleMessageEdit,
  handleMessageDelete,
  handleTypingStart,
  handleTypingStop,
  handlePresenceUpdate,
  handleDisconnect,
  type HandlerContext,
} from './handlers.js';

function createMockCtx(overrides?: Partial<HandlerContext>): HandlerContext {
  return {
    userId: 'user-1',
    store: new CommunicationStore(),
    push: vi.fn(),
    broadcastAll: vi.fn(),
    broadcast: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    ...overrides,
  };
}

describe('handlers', () => {
  describe('conversation join/leave', () => {
    it('joins a room', () => {
      const ctx = createMockCtx();
      handleConversationJoin(ctx, { conversationId: 'c1' });
      expect(ctx.joinRoom).toHaveBeenCalledWith('conv:c1');
    });

    it('leaves a room', () => {
      const ctx = createMockCtx();
      handleConversationLeave(ctx, { conversationId: 'c1' });
      expect(ctx.leaveRoom).toHaveBeenCalledWith('conv:c1');
    });
  });

  describe('message send', () => {
    it('sends a message without DB (in-memory)', () => {
      const ctx = createMockCtx();
      handleMessageSend(ctx, { conversationId: 'c1', content: 'Hello', type: 'text' });
      expect(ctx.broadcastAll).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        event: 'message:new',
        data: expect.objectContaining({ conversationId: 'c1', content: 'Hello', senderId: 'user-1', type: 'text', status: 'sent' }),
      }));
    });

    it('clears typing indicator on message send', () => {
      const ctx = createMockCtx();
      ctx.store.setTyping('c1', 'user-1', () => {});
      handleMessageSend(ctx, { conversationId: 'c1', content: 'Hi', type: 'text' });
      expect(ctx.store.getTypingUsers('c1')).toEqual([]);
    });

    it('handles encrypted message', () => {
      const ctx = createMockCtx();
      const envelope = { senderId: 'user-1', recipientId: 'user-2', sessionId: 's1', ciphertext: 'enc', messageType: 'message' as const, senderIdentityKey: 'k1' };
      handleMessageSend(ctx, { conversationId: 'c1', content: '', type: 'text', encrypted: true, envelope });
      expect(ctx.broadcastAll).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        data: expect.objectContaining({ encrypted: true, envelope }),
      }));
    });
  });

  describe('message read', () => {
    it('broadcasts read receipt', () => {
      const ctx = createMockCtx();
      handleMessageRead(ctx, { conversationId: 'c1', messageId: 'm1' });
      expect(ctx.broadcastAll).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        event: 'read-receipt:update',
        data: expect.objectContaining({ conversationId: 'c1', messageId: 'm1' }),
      }));
    });
  });

  describe('reactions', () => {
    it('broadcasts reaction without DB', () => {
      const ctx = createMockCtx();
      handleMessageReact(ctx, { messageId: 'm1', conversationId: 'c1', emoji: '👍' });
      expect(ctx.broadcastAll).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        event: 'message:reaction-update',
      }));
    });
  });

  describe('message edit', () => {
    it('broadcasts edit without DB', () => {
      const ctx = createMockCtx();
      handleMessageEdit(ctx, { messageId: 'm1', conversationId: 'c1', content: 'edited text' });
      expect(ctx.broadcastAll).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        event: 'message:updated',
        data: expect.objectContaining({ messageId: 'm1', content: 'edited text' }),
      }));
    });
  });

  describe('message delete', () => {
    it('broadcasts deletion without DB', () => {
      const ctx = createMockCtx();
      handleMessageDelete(ctx, { messageId: 'm1', conversationId: 'c1' });
      expect(ctx.broadcastAll).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        event: 'message:deleted',
        data: expect.objectContaining({ messageId: 'm1', conversationId: 'c1' }),
      }));
    });
  });

  describe('typing', () => {
    it('broadcasts typing start', () => {
      const ctx = createMockCtx();
      handleTypingStart(ctx, { conversationId: 'c1' });
      expect(ctx.broadcast).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        event: 'typing:update',
        data: expect.objectContaining({ conversationId: 'c1', userId: 'user-1', isTyping: true }),
      }));
    });

    it('broadcasts typing stop', () => {
      const ctx = createMockCtx();
      ctx.store.setTyping('c1', 'user-1', () => {});
      handleTypingStop(ctx, { conversationId: 'c1' });
      expect(ctx.broadcast).toHaveBeenCalledWith('conv:c1', expect.objectContaining({
        data: expect.objectContaining({ isTyping: false }),
      }));
    });
  });

  describe('presence', () => {
    it('sets presence and pushes update', () => {
      const ctx = createMockCtx();
      handlePresenceUpdate(ctx, { status: 'away' });
      expect(ctx.store.getPresence('user-1')?.status).toBe('away');
      expect(ctx.push).toHaveBeenCalledWith(expect.objectContaining({
        event: 'presence:changed',
        data: expect.objectContaining({ userId: 'user-1', status: 'away' }),
      }));
    });
  });

  describe('disconnect', () => {
    it('cleans up user state on disconnect', () => {
      const ctx = createMockCtx();
      ctx.store.mapUserSocket('user-1', 'socket-1');
      ctx.store.setTyping('c1', 'user-1', () => {});
      ctx.store.setPresence('user-1', 'online');
      handleDisconnect(ctx, 'socket-1');
      expect(ctx.store.getTypingUsers('c1')).toEqual([]);
      expect(ctx.store.getPresence('user-1')?.status).toBe('offline');
    });

    it('keeps user online if other sockets remain', () => {
      const ctx = createMockCtx();
      ctx.store.mapUserSocket('user-1', 'socket-1');
      ctx.store.mapUserSocket('user-1', 'socket-2');
      handleDisconnect(ctx, 'socket-1');
      expect(ctx.store.isUserOnline('user-1')).toBe(true);
    });
  });
});
