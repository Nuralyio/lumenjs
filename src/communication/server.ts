import type { CommunicationConfig } from './types.js';
import type { LumenDb } from '../db/index.js';
import { useCommunicationStore } from './store.js';
import {
  handleConversationCreate,
  handleConversationJoin,
  handleConversationLeave,
  handleConversationArchive,
  handleConversationMute,
  handleConversationPin,
  handleMessageSend,
  handleMessageRead,
  handleMessageReact,
  handleMessageEdit,
  handleMessageDelete,
  handleMessageForward,
  handleTypingStart,
  handleTypingStop,
  handlePresenceUpdate,
  handleDisconnect,
  type HandlerContext,
} from './handlers.js';
import {
  handleCallInitiate,
  handleCallRespond,
  handleCallHangup,
  handleCallMediaToggle,
  handleCallAddParticipant,
  handleCallRemoveParticipant,
  handleSignalOffer,
  handleSignalAnswer,
  handleSignalIceCandidate,
  handleSignalIceRestart,
  handleCallQualityReport,
  type SignalingContext,
} from './signaling.js';
import {
  handleUploadKeys,
  handleRequestKeys,
  handleSessionInit,
  type EncryptionContext,
} from './encryption.js';

/** Options for creating a communication socket handler */
export interface CommunicationHandlerOptions {
  /** Communication config overrides */
  config?: Partial<CommunicationConfig>;
  /** Extract userId from socket handshake headers/query. Default: reads X-User-Id header or userId query param */
  getUserId?: (headers: Record<string, any>, query: Record<string, any>) => string | undefined;
  /** LumenJS database instance — if provided, messages are persisted */
  db?: LumenDb;
}

const defaultGetUserId = (headers: Record<string, any>, query: Record<string, any>): string | undefined => {
  return headers['x-user-id'] || query.userId || undefined;
};

/**
 * Creates a LumenJS-compatible socket handler for communication.
 *
 * Usage in a page file:
 * ```ts
 * import { createCommunicationHandler } from '@nuraly/lumenjs/dist/communication/server.js';
 * export const socket = createCommunicationHandler();
 * ```
 */
export function createCommunicationHandler(options: CommunicationHandlerOptions = {}) {
  const getUserId = options.getUserId || defaultGetUserId;
  const store = useCommunicationStore();
  const resolvedConfig: CommunicationConfig = { ...options.config };

  // Apply configurable typing timeout to the store
  if (resolvedConfig.typingTimeoutMs != null) {
    store.typingTimeoutMs = resolvedConfig.typingTimeoutMs;
  }

  return (ctx: {
    on: (event: string, handler: (...args: any[]) => void) => void;
    push: (data: any) => void;
    room: {
      join: (name: string) => void;
      leave: (name: string) => void;
      broadcast: (name: string, data: any) => void;
      broadcastAll: (name: string, data: any) => void;
    };
    params: Record<string, string>;
    headers: Record<string, any>;
    locale?: string;
    socket: any;
  }) => {
    const query = ctx.socket?.handshake?.query || {};
    const userId = getUserId(ctx.headers, query);

    if (!userId) {
      console.warn('[LumenJS:Communication] No userId found in socket handshake. Connection rejected.');
      ctx.socket?.disconnect?.();
      return;
    }

    const socketId: string = ctx.socket?.id || crypto.randomUUID();

    // Register socket
    store.mapUserSocket(userId, socketId);
    store.setPresence(userId, 'online');

    // Build handler context
    const handlerCtx: HandlerContext = {
      userId,
      store,
      config: resolvedConfig,
      push: ctx.push,
      broadcastAll: ctx.room.broadcastAll,
      broadcast: ctx.room.broadcast,
      joinRoom: ctx.room.join,
      leaveRoom: ctx.room.leave,
      emitToUser: (targetUserId: string, data: any) => {
        const sockets = store.getSocketsForUser(targetUserId);
        const io = ctx.socket?.nsp;
        if (io) {
          for (const sid of sockets) {
            io.to(sid).emit('nk:data', data);
          }
        }
      },
      db: options.db,
    };

    // Build signaling context
    const signalingCtx: SignalingContext = {
      userId,
      store,
      emitToSocket: (sid: string, data: any) => {
        // For targeted emit, we use the raw socket.io namespace
        const io = ctx.socket?.nsp;
        if (io) {
          io.to(sid).emit('nk:data', data);
        }
      },
      broadcastAll: ctx.room.broadcastAll,
    };

    // ── Chat Events ──────────────────────────────────────────

    ctx.on('conversation:create', (data) => handleConversationCreate(handlerCtx, data));
    ctx.on('conversation:join', (data) => handleConversationJoin(handlerCtx, data));
    ctx.on('conversation:leave', (data) => handleConversationLeave(handlerCtx, data));
    ctx.on('conversation:archive', (data) => handleConversationArchive(handlerCtx, data));
    ctx.on('conversation:mute', (data) => handleConversationMute(handlerCtx, data));
    ctx.on('conversation:pin', (data) => handleConversationPin(handlerCtx, data));
    ctx.on('message:send', (data) => handleMessageSend(handlerCtx, data));
    ctx.on('message:react', (data) => handleMessageReact(handlerCtx, data));
    ctx.on('message:edit', (data) => handleMessageEdit(handlerCtx, data));
    ctx.on('message:delete', (data) => handleMessageDelete(handlerCtx, data));
    ctx.on('message:read', (data) => handleMessageRead(handlerCtx, data));
    ctx.on('message:forward', (data) => handleMessageForward(handlerCtx, data));
    ctx.on('typing:start', (data) => handleTypingStart(handlerCtx, data));
    ctx.on('typing:stop', (data) => handleTypingStop(handlerCtx, data));
    ctx.on('presence:update', (data) => handlePresenceUpdate(handlerCtx, data));

    // ── Call Events ──────────────────────────────────────────

    ctx.on('call:initiate', (data) => handleCallInitiate(signalingCtx, data));
    ctx.on('call:respond', (data) => handleCallRespond(signalingCtx, data));
    ctx.on('call:hangup', (data) => handleCallHangup(signalingCtx, data));
    ctx.on('call:media-toggle', (data) => handleCallMediaToggle(signalingCtx, data));
    ctx.on('call:add-participant', (data) => handleCallAddParticipant(signalingCtx, data));
    ctx.on('call:remove-participant', (data) => handleCallRemoveParticipant(signalingCtx, data));

    // ── WebRTC Signaling ─────────────────────────────────────

    ctx.on('signal:offer', (data) => handleSignalOffer(signalingCtx, data));
    ctx.on('signal:answer', (data) => handleSignalAnswer(signalingCtx, data));
    ctx.on('signal:ice-candidate', (data) => handleSignalIceCandidate(signalingCtx, data));
    ctx.on('signal:ice-restart', (data) => handleSignalIceRestart(signalingCtx, data));
    ctx.on('call:quality-report', (data) => handleCallQualityReport(signalingCtx, data));

    // ── E2E Encryption ─────────────────────────────────────────

    const encryptionCtx: EncryptionContext = {
      userId,
      store,
      push: ctx.push,
      emitToUser: (targetUserId: string, data: any) => {
        const sockets = store.getSocketsForUser(targetUserId);
        const io = ctx.socket?.nsp;
        if (io) {
          for (const sid of sockets) {
            io.to(sid).emit('nk:data', data);
          }
        }
      },
      db: options.db,
    };

    ctx.on('encryption:upload-keys', (data) => handleUploadKeys(encryptionCtx, data));
    ctx.on('encryption:request-keys', (data) => handleRequestKeys(encryptionCtx, data));
    ctx.on('encryption:session-init', (data) => handleSessionInit(encryptionCtx, data));

    // ── Cleanup on Disconnect ────────────────────────────────

    return () => {
      handleDisconnect(handlerCtx, socketId);
    };
  };
}

/**
 * Creates reusable API handler functions for communication REST endpoints.
 *
 * Usage in an API route:
 * ```ts
 * import { createCommunicationApiHandlers } from '@nuraly/lumenjs/dist/communication/server.js';
 * import { useDb } from '@nuraly/lumenjs/dist/db/index.js';
 *
 * const communication = createCommunicationApiHandlers(useDb());
 *
 * export function GET(req) {
 *   return communication.getConversations(req.query.userId);
 * }
 * ```
 */
export function createCommunicationApiHandlers(db: LumenDb) {
  return {
    /** List conversations for a user */
    getConversations(userId: string, opts?: { limit?: number; offset?: number }) {
      const limit = opts?.limit || 50;
      const offset = opts?.offset || 0;
      return db.all(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
                 AND m.id NOT IN (SELECT message_id FROM read_receipts WHERE user_id = ?)) as unread_count
         FROM conversations c
         JOIN conversation_participants cp ON cp.conversation_id = c.id
         WHERE cp.user_id = ?
         ORDER BY c.updated_at DESC
         LIMIT ? OFFSET ?`,
        userId, userId, limit, offset,
      );
    },

    /** Get paginated message history for a conversation */
    getMessages(conversationId: string, opts?: { limit?: number; before?: string }) {
      const limit = opts?.limit || 50;
      if (opts?.before) {
        return db.all(
          `SELECT * FROM messages WHERE conversation_id = ? AND created_at < ?
           ORDER BY created_at DESC LIMIT ?`,
          conversationId, opts.before, limit,
        );
      }
      return db.all(
        `SELECT * FROM messages WHERE conversation_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        conversationId, limit,
      );
    },

    /** Create a new conversation */
    createConversation(data: { type: 'direct' | 'group'; name?: string; participantIds: string[] }) {
      const now = new Date().toISOString();
      const result = db.run(
        `INSERT INTO conversations (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        crypto.randomUUID(), data.type, data.name || null, now, now,
      );
      const convId = String(result.lastInsertRowid);

      for (const uid of data.participantIds) {
        db.run(
          `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
          convId, uid, now,
        );
      }

      return db.get(`SELECT * FROM conversations WHERE rowid = ?`, result.lastInsertRowid);
    },

    /** Search messages by content */
    searchMessages(query: string, opts?: { conversationId?: string; limit?: number }) {
      const limit = opts?.limit || 20;
      if (opts?.conversationId) {
        return db.all(
          `SELECT * FROM messages WHERE conversation_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?`,
          opts.conversationId, `%${query}%`, limit,
        );
      }
      return db.all(
        `SELECT * FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?`,
        `%${query}%`, limit,
      );
    },

    /** Get a single message by ID */
    getMessage(messageId: string) {
      return db.get(`SELECT * FROM messages WHERE id = ?`, messageId);
    },

    /** Delete a message (soft delete by setting content to empty) */
    deleteMessage(messageId: string, userId: string) {
      return db.run(
        `UPDATE messages SET content = '', type = 'system', updated_at = ? WHERE id = ? AND sender_id = ?`,
        new Date().toISOString(), messageId, userId,
      );
    },
  };
}
