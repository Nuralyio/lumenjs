import type { Conversation } from '../types.js';
import type { HandlerContext } from './context.js';

// ── Conversation ────────────────────────────────────────────────

export function handleConversationCreate(
  ctx: HandlerContext,
  data: { type: 'direct' | 'group'; name?: string; participantIds: string[] },
): void {
  const now = new Date().toISOString();

  let conversation: Conversation;

  if (ctx.db) {
    const convId = crypto.randomUUID();
    ctx.db.run(
      `INSERT INTO conversations (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      convId, data.type, data.name || null, now, now,
    );

    // Add the creator as a participant with 'owner' role
    const allParticipantIds = [ctx.userId, ...data.participantIds.filter(id => id !== ctx.userId)];
    for (const uid of allParticipantIds) {
      const role = uid === ctx.userId ? 'owner' : 'member';
      ctx.db.run(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
        convId, uid, role, now,
      );
    }

    conversation = {
      id: convId,
      type: data.type,
      name: data.name,
      participants: allParticipantIds.map(uid => ({
        userId: uid,
        displayName: '',
        role: uid === ctx.userId ? 'owner' as const : 'member' as const,
        joinedAt: now,
        presence: ctx.store.getPresence(uid)?.status || 'offline',
      })),
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
    };
  } else {
    const allParticipantIds = [ctx.userId, ...data.participantIds.filter(id => id !== ctx.userId)];
    conversation = {
      id: crypto.randomUUID(),
      type: data.type,
      name: data.name,
      participants: allParticipantIds.map(uid => ({
        userId: uid,
        displayName: '',
        role: uid === ctx.userId ? 'owner' as const : 'member' as const,
        joinedAt: now,
        presence: ctx.store.getPresence(uid)?.status || 'offline',
      })),
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
    };
  }

  // Auto-join the creator to the conversation room
  ctx.joinRoom(`conv:${conversation.id}`);

  // Notify the creator
  ctx.push({ event: 'conversation:new', data: conversation });

  // Notify other participants (they haven't joined the room yet)
  if (ctx.emitToUser) {
    for (const uid of data.participantIds) {
      if (uid !== ctx.userId) {
        ctx.emitToUser(uid, { event: 'conversation:new', data: conversation });
      }
    }
  }
}

export function handleConversationJoin(ctx: HandlerContext, data: { conversationId: string }): void {
  // Verify the user is an actual participant of this conversation
  if (ctx.db) {
    const row = ctx.db.get(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      data.conversationId, ctx.userId,
    );
    if (!row) {
      ctx.push({ event: 'error', data: { code: 'FORBIDDEN', message: 'Not a participant of this conversation' } });
      return;
    }
  }

  ctx.joinRoom(`conv:${data.conversationId}`);
  ctx.store.addConversationMember(data.conversationId, ctx.userId);
  ctx.store.joinConversation(ctx.userId, data.conversationId);
}

export function handleConversationLeave(ctx: HandlerContext, data: { conversationId: string }): void {
  ctx.leaveRoom(`conv:${data.conversationId}`);
  ctx.store.removeConversationMember(data.conversationId, ctx.userId);
  ctx.store.leaveConversation(ctx.userId, data.conversationId);
}

export function handleConversationArchive(
  ctx: HandlerContext,
  data: { conversationId: string; archived: boolean },
): void {
  // Verify the user is a participant
  if (ctx.db) {
    const row = ctx.db.get(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      data.conversationId, ctx.userId,
    );
    if (!row) {
      ctx.push({ event: 'error', data: { code: 'FORBIDDEN', message: 'Not a participant of this conversation' } });
      return;
    }
    ctx.db.run(
      `UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?`,
      data.archived ? 1 : 0, new Date().toISOString(), data.conversationId,
    );
  }

  ctx.broadcastAll(`conv:${data.conversationId}`, {
    event: 'conversation:updated',
    data: { id: data.conversationId, archived: data.archived },
  });
}

export function handleConversationMute(
  ctx: HandlerContext,
  data: { conversationId: string; muted: boolean },
): void {
  if (ctx.db) {
    ctx.db.run(
      `UPDATE conversation_participants SET muted = ?, updated_at = ? WHERE conversation_id = ? AND user_id = ?`,
      data.muted ? 1 : 0, new Date().toISOString(), data.conversationId, ctx.userId,
    );
  }

  // Only notify the requesting user — mute is per-user
  ctx.push({
    event: 'conversation:updated',
    data: { id: data.conversationId, muted: data.muted },
  });
}

export function handleConversationPin(
  ctx: HandlerContext,
  data: { conversationId: string; pinned: boolean },
): void {
  if (ctx.db) {
    ctx.db.run(
      `UPDATE conversation_participants SET pinned = ?, updated_at = ? WHERE conversation_id = ? AND user_id = ?`,
      data.pinned ? 1 : 0, new Date().toISOString(), data.conversationId, ctx.userId,
    );
  }

  // Only notify the requesting user — pin is per-user
  ctx.push({
    event: 'conversation:updated',
    data: { id: data.conversationId, pinned: data.pinned },
  });
}
