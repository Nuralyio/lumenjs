import type { Message, MessageAttachment, MessageForward, ReadReceipt, EncryptedEnvelope } from '../types.js';
import type { HandlerContext } from './context.js';

// ── Messages ────────────────────────────────────────────────────

export function handleMessageSend(
  ctx: HandlerContext,
  data: { conversationId: string; content: string; type: Message['type']; replyTo?: string; attachment?: MessageAttachment; encrypted?: boolean; envelope?: EncryptedEnvelope },
): void {
  // ── Membership check ──────────────────────────────────────────
  if (ctx.db) {
    const row = ctx.db.get(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      data.conversationId, ctx.userId,
    );
    if (!row) {
      ctx.push({ event: 'message:error', data: { code: 'FORBIDDEN', message: 'Not a participant of this conversation' } });
      return;
    }
  } else {
    const members = ctx.store.getConversationMembers(data.conversationId);
    if (members.size > 0 && !members.has(ctx.userId)) {
      ctx.push({ event: 'message:error', data: { code: 'FORBIDDEN', message: 'Not a participant of this conversation' } });
      return;
    }
  }

  // ── Message length check ──────────────────────────────────────
  const maxLen = ctx.config.maxMessageLength ?? 10_000;
  if (data.content && data.content.length > maxLen) {
    ctx.push({ event: 'message:error', data: { code: 'MESSAGE_TOO_LONG', message: `Message exceeds maximum length of ${maxLen} characters.` } });
    return;
  }

  // ── Rate limit check ──────────────────────────────────────────
  if (ctx.config.rateLimit) {
    const allowed = ctx.store.checkRateLimit(ctx.userId, ctx.config.rateLimit);
    if (!allowed) {
      ctx.push({ event: 'message:error', data: { code: 'RATE_LIMITED', message: 'Message rate limit exceeded. Please wait before sending more messages.' } });
      return;
    }
  }

  // ── File upload validation ────────────────────────────────────
  if (data.attachment && ctx.config.fileUpload) {
    const { maxFileSize, allowedMimeTypes } = ctx.config.fileUpload;

    if (data.attachment.fileSize > maxFileSize) {
      ctx.push({ event: 'message:error', data: { code: 'FILE_TOO_LARGE', message: `File size ${data.attachment.fileSize} exceeds maximum allowed size of ${maxFileSize} bytes.` } });
      return;
    }

    if (allowedMimeTypes && allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(data.attachment.mimeType)) {
      ctx.push({ event: 'message:error', data: { code: 'MIME_TYPE_NOT_ALLOWED', message: `MIME type '${data.attachment.mimeType}' is not allowed.` } });
      return;
    }
  }

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

  // Notify sender that the message has been persisted
  ctx.push({ event: 'message:status', data: { messageId: message.id, status: 'sent' as const } });

  // Broadcast to all participants in the conversation
  ctx.broadcastAll(`conv:${data.conversationId}`, { event: 'message:new', data: message });

  // Check if any recipient in the conversation has a connected socket
  const members = ctx.store.getConversationMembers(data.conversationId);
  const hasOnlineRecipient = Array.from(members).some(
    (uid) => uid !== ctx.userId && ctx.store.isUserOnline(uid),
  );

  if (hasOnlineRecipient) {
    if (ctx.db) {
      ctx.db.run(
        `UPDATE messages SET status = 'delivered' WHERE id = ? AND status = 'sent'`,
        message.id,
      );
    }
    message.status = 'delivered';
    ctx.push({ event: 'message:status', data: { messageId: message.id, status: 'delivered' as const } });
  }
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

  // Emit message:status so clients can update delivery indicators
  ctx.broadcastAll(`conv:${data.conversationId}`, {
    event: 'message:status',
    data: { messageId: data.messageId, status: 'read' as const },
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
    // Only allow sender to edit — return early if not the owner
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
    // Only allow sender to delete — return early if not the owner
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

// ── Message Forward ─────────────────────────────────────────────

export function handleMessageForward(
  ctx: HandlerContext,
  data: MessageForward,
): void {
  const now = new Date().toISOString();

  if (ctx.db) {
    // Fetch the original message
    const original = ctx.db.get(`SELECT * FROM messages WHERE id = ?`, data.messageId) as any;
    if (!original) return;

    // Insert a forwarded copy into the target conversation
    const result = ctx.db.run(
      `INSERT INTO messages (conversation_id, sender_id, content, type, status, encrypted, created_at, forwarded_from_conversation_id, forwarded_from_message_id)
       VALUES (?, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
      data.toConversationId,
      ctx.userId,
      original.content,
      original.type,
      original.encrypted || 0,
      now,
      data.fromConversationId,
      data.messageId,
    );

    const forwarded: Message & { forwardedFrom?: { conversationId: string; messageId: string } } = {
      id: String(result.lastInsertRowid),
      conversationId: data.toConversationId,
      senderId: ctx.userId,
      content: original.content,
      type: original.type,
      createdAt: now,
      status: 'sent',
      readBy: [],
      encrypted: !!original.encrypted,
      forwardedFrom: {
        conversationId: data.fromConversationId,
        messageId: data.messageId,
      },
    };

    ctx.db.run(
      `UPDATE conversations SET updated_at = ? WHERE id = ?`,
      now, data.toConversationId,
    );

    ctx.broadcastAll(`conv:${data.toConversationId}`, { event: 'message:forwarded', data: forwarded });
  } else {
    const forwarded: Message & { forwardedFrom?: { conversationId: string; messageId: string } } = {
      id: crypto.randomUUID(),
      conversationId: data.toConversationId,
      senderId: ctx.userId,
      content: '',
      type: 'text',
      createdAt: now,
      status: 'sent',
      readBy: [],
      forwardedFrom: {
        conversationId: data.fromConversationId,
        messageId: data.messageId,
      },
    };

    ctx.broadcastAll(`conv:${data.toConversationId}`, { event: 'message:forwarded', data: forwarded });
  }
}
