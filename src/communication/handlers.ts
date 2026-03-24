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

// ── Message Reactions ────────────────────────────────────────────

export function handleMessageReact(
  ctx: HandlerContext,
  data: { messageId: string; conversationId: string; emoji: string },
): void {
  if (ctx.db) {
    // Toggle: if already reacted with this emoji, remove it
    const existing = ctx.db.get(
      'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      data.messageId, ctx.userId, data.emoji,
    );
    if (existing) {
      ctx.db.run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', data.messageId, ctx.userId, data.emoji);
    } else {
      ctx.db.run('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', data.messageId, ctx.userId, data.emoji);
    }

    // Fetch all reactions for this message
    const reactions = ctx.db.all(
      'SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_id) as users FROM message_reactions WHERE message_id = ? GROUP BY emoji',
      data.messageId,
    );
    ctx.broadcastAll(`conv:${data.conversationId}`, {
      event: 'message:reaction-update',
      data: { messageId: data.messageId, reactions: reactions.map((r: any) => ({ emoji: r.emoji, count: r.count, users: r.users.split(',') })) },
    });
  } else {
    // Without DB, just broadcast the reaction event
    ctx.broadcastAll(`conv:${data.conversationId}`, {
      event: 'message:reaction-update',
      data: { messageId: data.messageId, reactions: [{ emoji: data.emoji, count: 1, users: [ctx.userId] }] },
    });
  }
}

// ── Message Edit ────────────────────────────────────────────────

export function handleMessageEdit(
  ctx: HandlerContext,
  data: { messageId: string; conversationId: string; content: string },
): void {
  const now = new Date().toISOString();

  if (ctx.db) {
    // Only allow sender to edit
    const msg = ctx.db.get('SELECT sender_id FROM messages WHERE id = ?', data.messageId);
    if (!msg || (msg as any).sender_id !== ctx.userId) return;

    ctx.db.run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ? AND sender_id = ?',
      data.content, now, data.messageId, ctx.userId);
  }

  ctx.broadcastAll(`conv:${data.conversationId}`, {
    event: 'message:updated',
    data: { messageId: data.messageId, content: data.content, updatedAt: now, editedBy: ctx.userId },
  });
}

// ── Message Delete ──────────────────────────────────────────────

export function handleMessageDelete(
  ctx: HandlerContext,
  data: { messageId: string; conversationId: string },
): void {
  if (ctx.db) {
    // Only allow sender to delete
    const msg = ctx.db.get('SELECT sender_id FROM messages WHERE id = ?', data.messageId);
    if (!msg || (msg as any).sender_id !== ctx.userId) return;

    ctx.db.run("UPDATE messages SET content = '', type = 'system', updated_at = ? WHERE id = ? AND sender_id = ?",
      new Date().toISOString(), data.messageId, ctx.userId);
  }

  ctx.broadcastAll(`conv:${data.conversationId}`, {
    event: 'message:deleted',
    data: { messageId: data.messageId, conversationId: data.conversationId, deletedBy: ctx.userId },
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
