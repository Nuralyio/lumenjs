import type { PresenceStatus } from '../types.js';
import type { HandlerContext } from './context.js';

// ── Typing ──────────────────────────────────────────────────────

export function handleTypingStart(ctx: HandlerContext, data: { conversationId: string }): void {
  ctx.store.setTyping(data.conversationId, ctx.userId, () => {
    // Auto-expire: broadcast typing stopped
    ctx.broadcastAll(`conv:${data.conversationId}`, {
      event: 'typing:update',
      data: { conversationId: data.conversationId, userId: ctx.userId, isTyping: false },
    });
  });

  ctx.broadcast(`conv:${data.conversationId}`, {
    event: 'typing:update',
    data: { conversationId: data.conversationId, userId: ctx.userId, isTyping: true },
  });
}

export function handleTypingStop(ctx: HandlerContext, data: { conversationId: string }): void {
  ctx.store.clearTyping(data.conversationId, ctx.userId);

  ctx.broadcast(`conv:${data.conversationId}`, {
    event: 'typing:update',
    data: { conversationId: data.conversationId, userId: ctx.userId, isTyping: false },
  });
}

// ── Presence ────────────────────────────────────────────────────

/** Broadcast online status to all conversation rooms when a user connects */
export function handleConnect(ctx: HandlerContext): void {
  const conversations = ctx.store.getUserConversations(ctx.userId);
  if (conversations.size === 0) return;

  const entry = ctx.store.getPresence(ctx.userId);
  if (!entry) return;

  const payload = {
    event: 'presence:changed',
    data: { userId: ctx.userId, status: entry.status, lastSeen: entry.lastSeen },
  };

  for (const convId of conversations) {
    ctx.broadcastAll(`conv:${convId}`, payload);
  }
}

export function handlePresenceUpdate(ctx: HandlerContext, data: { status: PresenceStatus }): void {
  const entry = ctx.store.setPresence(ctx.userId, data.status);
  const payload = {
    event: 'presence:changed',
    data: { userId: ctx.userId, status: entry.status, lastSeen: entry.lastSeen },
  };

  // Broadcast to all conversation rooms the user has joined
  for (const convId of ctx.store.getUserConversations(ctx.userId)) {
    ctx.broadcastAll(`conv:${convId}`, payload);
  }
}

/** Called on disconnect to clean up user state */
export function handleDisconnect(ctx: HandlerContext, socketId: string): void {
  const userId = ctx.store.unmapUserSocket(socketId);
  if (!userId) return;

  // Clear all typing indicators for this user
  const clearedConversations = ctx.store.clearAllTypingForUser(userId);
  for (const convId of clearedConversations) {
    ctx.broadcastAll(`conv:${convId}`, {
      event: 'typing:update',
      data: { conversationId: convId, userId, isTyping: false },
    });
  }

  // If user has no more connected sockets, set presence to offline and broadcast
  if (!ctx.store.isUserOnline(userId)) {
    const entry = ctx.store.setPresence(userId, 'offline');
    const payload = {
      event: 'presence:changed',
      data: { userId, status: 'offline', lastSeen: entry.lastSeen },
    };

    // Broadcast offline to all conversation rooms before cleaning up membership
    for (const convId of ctx.store.getUserConversations(userId)) {
      ctx.broadcastAll(`conv:${convId}`, payload);
    }

    ctx.store.removeUserFromAllConversations(userId);
  }
}
