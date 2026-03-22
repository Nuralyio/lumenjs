import type { Message, MessageAttachment, PresenceStatus, ReadReceipt, EncryptedEnvelope } from './types.js';
import type { CommunicationStore } from './store.js';
import type { LumenDb } from '../db/index.js';

/** Context passed to every handler from the socket connection */
export interface HandlerContext {
  userId: string;
  store: CommunicationStore;
  /** Emit data to the current socket */
  push: (data: any) => void;
  /** Broadcast to all sockets in a room */
  broadcastAll: (room: string, data: any) => void;
  /** Broadcast to all sockets in a room except the sender */
  broadcast: (room: string, data: any) => void;
  /** Join a socket room */
  joinRoom: (room: string) => void;
  /** Leave a socket room */
  leaveRoom: (room: string) => void;
  /** LumenJS database instance (optional — only if app has DB set up) */
  db?: LumenDb;
}

// ── Conversation ────────────────────────────────────────────────

export function handleConversationJoin(ctx: HandlerContext, data: { conversationId: string }): void {
  ctx.joinRoom(`conv:${data.conversationId}`);
}

export function handleConversationLeave(ctx: HandlerContext, data: { conversationId: string }): void {
  ctx.leaveRoom(`conv:${data.conversationId}`);
}

// ── Messages ────────────────────────────────────────────────────

export function handleMessageSend(
  ctx: HandlerContext,
  data: { conversationId: string; content: string; type: Message['type']; replyTo?: string; attachment?: MessageAttachment; encrypted?: boolean; envelope?: EncryptedEnvelope },
): void {
  const now = new Date().toISOString();
  let message: Message;

  // For encrypted messages, content is ciphertext — server stores it as opaque blob
  const contentToStore = data.encrypted && data.envelope
    ? JSON.stringify(data.envelope)
    : data.content;

  if (ctx.db) {
    const result = ctx.db.run(
      `INSERT INTO messages (conversation_id, sender_id, content, type, reply_to, attachment, status, encrypted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
      data.conversationId,
      ctx.userId,
      contentToStore,
      data.type,
      data.replyTo || null,
      data.attachment ? JSON.stringify(data.attachment) : null,
      data.encrypted ? 1 : 0,
      now,
    );

    message = {
      id: String(result.lastInsertRowid),
      conversationId: data.conversationId,
      senderId: ctx.userId,
      content: contentToStore,
      type: data.type,
      createdAt: now,
      replyTo: data.replyTo,
      attachment: data.attachment,
      status: 'sent',
      readBy: [],
      encrypted: data.encrypted,
      envelope: data.envelope,
    };

    // Update conversation's last activity
    ctx.db.run(
      `UPDATE conversations SET updated_at = ? WHERE id = ?`,
      now,
      data.conversationId,
    );
  } else {
    // Without DB, create an in-memory message
    message = {
      id: crypto.randomUUID(),
      conversationId: data.conversationId,
      senderId: ctx.userId,
      content: contentToStore,
      type: data.type,
      createdAt: now,
      replyTo: data.replyTo,
      attachment: data.attachment,
      status: 'sent',
      readBy: [],
      encrypted: data.encrypted,
      envelope: data.envelope,
    };
  }

  // Clear typing indicator since the user just sent a message
  ctx.store.clearTyping(data.conversationId, ctx.userId);

  // Broadcast to all participants in the conversation
  ctx.broadcastAll(`conv:${data.conversationId}`, { event: 'message:new', data: message });
}

export function handleMessageRead(
  ctx: HandlerContext,
  data: { conversationId: string; messageId: string },
): void {
  const now = new Date().toISOString();
  const receipt: ReadReceipt = { userId: ctx.userId, readAt: now };

  if (ctx.db) {
    // Insert read receipt (ignore duplicates)
    ctx.db.run(
      `INSERT OR IGNORE INTO read_receipts (message_id, user_id, read_at) VALUES (?, ?, ?)`,
      data.messageId,
      ctx.userId,
      now,
    );

    // Update message status to 'read' if all participants have read it
    ctx.db.run(
      `UPDATE messages SET status = 'read' WHERE id = ? AND status != 'read'`,
      data.messageId,
    );
  }

  ctx.broadcastAll(`conv:${data.conversationId}`, {
    event: 'read-receipt:update',
    data: { conversationId: data.conversationId, messageId: data.messageId, readBy: receipt },
  });
}

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

export function handlePresenceUpdate(ctx: HandlerContext, data: { status: PresenceStatus }): void {
  const entry = ctx.store.setPresence(ctx.userId, data.status);

  // Broadcast to all rooms the user is part of — the socket.io broadcast handles this
  ctx.push({
    event: 'presence:changed',
    data: { userId: ctx.userId, status: entry.status, lastSeen: entry.lastSeen },
  });
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

  // If user has no more connected sockets, set presence to offline
  if (!ctx.store.isUserOnline(userId)) {
    const entry = ctx.store.setPresence(userId, 'offline');
    ctx.push({
      event: 'presence:changed',
      data: { userId, status: 'offline', lastSeen: entry.lastSeen },
    });
  }
}
