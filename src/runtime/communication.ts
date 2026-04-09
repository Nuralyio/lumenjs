/**
 * Client-side communication SDK.
 * Connects to the server via Socket.io and provides a clean API for chat, typing, presence, and calls.
 */

let _socket: any = null;
let _handlers: Map<string, Set<Function>> = new Map();
let _connectingPromise: Promise<any> | null = null;
// Incremented on every disconnect() to cancel any in-flight connectChat() calls.
let _sessionId = 0;

function emit(event: string, data: any): void {
  if (!_socket) return;
  _socket.emit(`nk:${event}`, data);
}

function addHandler(event: string, handler: Function): void {
  let set = _handlers.get(event);
  if (!set) { set = new Set(); _handlers.set(event, set); }
  set.add(handler);
}

function removeHandler(event: string, handler: Function): void {
  _handlers.get(event)?.delete(handler);
}

/**
 * Connect to the communication socket.
 * Reuses an existing socket if one is already connected.
 */
export async function connectChat(params?: Record<string, string>): Promise<any> {
  // Return existing socket if active (connecting or connected).
  // socket.active is false only after an explicit socket.io disconnect().
  if (_socket && _socket.active !== false) return _socket;
  // Prevent race: if another connectChat call is already in-flight, wait for it.
  // (_connectingPromise is set synchronously before the first await, so concurrent
  // calls within the same tick are guaranteed to see it.)
  if (_connectingPromise) return _connectingPromise;
  _connectingPromise = (async () => {
    const sid = _sessionId; // snapshot: if disconnect() fires during await, sid will differ
    const { io } = await import('socket.io-client');
    // If disconnect() was called while we were waiting for the import, abort.
    if (_sessionId !== sid) { _connectingPromise = null; return null; }
    _socket = io('/nk/messages', {
      path: '/__nk_socketio/',
      query: { ...params, __params: JSON.stringify(params || {}) },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    // Capture _handlers by value so this socket's listener is bound to the
    // current session's handler map. If disconnect() replaces _handlers with a
    // new Map, this socket can no longer dispatch to handlers from a later session.
    const sessionHandlers = _handlers;
    _socket.on('nk:data', (data: any) => {
      if (data?.event) {
        const handlers = sessionHandlers.get(data.event);
        if (handlers) {
          for (const h of handlers) h(data.data);
        }
      }
    });
    _connectingPromise = null;
    return _socket;
  })();
  return _connectingPromise;
}

/** Get the underlying socket instance (for call-service or other integrations) */
export function getSocket(): any { return _socket; }

/** Set an externally-created socket (e.g. from call-service or router) */
export function setSocket(socket: any): void {
  if (_socket === socket) return;
  _socket = socket;
  // Attach the nk:data handler if not already attached
  if (_socket && !(_socket as any).__nk_comm_attached) {
    (_socket as any).__nk_comm_attached = true;
    const sessionHandlers = _handlers;
    _socket.on('nk:data', (data: any) => {
      if (data?.event) {
        const handlers = sessionHandlers.get(data.event);
        if (handlers) {
          for (const h of handlers) h(data.data);
        }
      }
    });
  }
}

// ── Messages ─────────────────────────────────────────────────────

/** Send a message (text, image, file, audio) */
export function sendMessage(conversationId: string, content: string, opts?: {
  type?: string;
  attachment?: any;
  replyTo?: any;
  encrypted?: boolean;
}): void {
  emit('message:send', {
    conversationId,
    content,
    type: opts?.type || 'text',
    ...(opts?.attachment ? { attachment: opts.attachment } : {}),
    ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
    ...(opts?.encrypted ? { encrypted: true } : {}),
  });
}

/** Mark messages as read */
export function markRead(conversationId: string, messageIds?: string[]): void {
  emit('message:read', { conversationId, ...(messageIds ? { messageIds } : {}) });
}

/** React to a message with an emoji (toggle) */
export function reactToMessage(messageId: string, conversationId: string, emoji: string): void {
  emit('message:react', { messageId, conversationId, emoji });
}

/** Edit a message */
export function editMessage(messageId: string, conversationId: string, content: string): void {
  emit('message:edit', { messageId, conversationId, content });
}

/** Delete a message */
export function deleteMessage(messageId: string, conversationId: string): void {
  emit('message:delete', { messageId, conversationId });
}

/** Load messages for a conversation (lazy-load) */
export function loadMessages(conversationId: string): void {
  emit('conversation:load-messages', { conversationId });
}

/** Join a conversation room to receive messages */
export function joinConversation(conversationId: string): void {
  emit('conversation:join', { conversationId });
}

/** Leave a conversation room */
export function leaveConversation(conversationId: string): void {
  emit('conversation:leave', { conversationId });
}

// ── Typing ───────────────────────────────────────────────────────

/** Start typing indicator */
export function startTyping(conversationId: string): void {
  emit('typing:start', { conversationId });
}

/** Stop typing indicator */
export function stopTyping(conversationId: string): void {
  emit('typing:stop', { conversationId });
}

// ── Presence ─────────────────────────────────────────────────────

/** Update presence status */
export function updatePresence(status: 'online' | 'offline' | 'away' | 'busy'): void {
  emit('presence:update', { status });
}

/** Request bulk presence sync for a list of user IDs */
export function requestPresenceSync(userIds: string[]): void {
  emit('presence:sync', { userIds });
}

/** Refresh notification/message badge counts */
export function refreshBadge(): void {
  emit('badge:refresh', {});
}

// ── Event Listeners ──────────────────────────────────────────────

/** Listen for new messages */
export function onMessage(handler: (message: any) => void): () => void {
  addHandler('message:new', handler);
  return () => removeHandler('message:new', handler);
}

/** Listen for typing updates */
export function onTyping(handler: (data: { conversationId: string; userId: string; isTyping: boolean }) => void): () => void {
  addHandler('typing:update', handler);
  return () => removeHandler('typing:update', handler);
}

/** Listen for presence changes */
export function onPresence(handler: (data: { userId: string; status: string; lastSeen: string }) => void): () => void {
  addHandler('presence:changed', handler);
  return () => removeHandler('presence:changed', handler);
}

/** Listen for bulk presence sync response */
export function onPresenceSync(handler: (data: { presences: Record<string, any> }) => void): () => void {
  addHandler('presence:sync', handler);
  return () => removeHandler('presence:sync', handler);
}

/** Listen for reaction updates */
export function onReactionUpdate(handler: (data: { messageId: string; reactions: any[] }) => void): () => void {
  addHandler('message:reaction-update', handler);
  return () => removeHandler('message:reaction-update', handler);
}

/** Listen for message edits */
export function onMessageUpdated(handler: (data: { messageId: string; content: string; updatedAt: string }) => void): () => void {
  addHandler('message:updated', handler);
  return () => removeHandler('message:updated', handler);
}

/** Listen for message deletions */
export function onMessageDeleted(handler: (data: { messageId: string; conversationId: string }) => void): () => void {
  addHandler('message:deleted', handler);
  return () => removeHandler('message:deleted', handler);
}

/** Listen for read receipts */
export function onReadReceipt(handler: (data: any) => void): () => void {
  addHandler('read-receipt:update', handler);
  return () => removeHandler('read-receipt:update', handler);
}

/** Listen for message acknowledgements (server returns DB id for optimistic messages) */
export function onMessageAck(handler: (data: { conversationId: string; id: string | number; tempTime: string }) => void): () => void {
  addHandler('message:ack', handler);
  return () => removeHandler('message:ack', handler);
}

/** Listen for lazy-loaded conversation messages */
export function onConversationMessages(handler: (data: { conversationId: string; messages: any[]; participants: any[] }) => void): () => void {
  addHandler('conversation:messages', handler);
  return () => removeHandler('conversation:messages', handler);
}

// ── File Uploads & Link Previews ─────────────────────────────────

/** Upload a file (returns attachment metadata) */
export async function uploadFile(file: Blob, filename: string, encrypted = false): Promise<{ id: string; url: string; size: number }> {
  const res = await fetch('/__nk_comm/upload', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': filename,
      ...(encrypted ? { 'X-Encrypted': '1' } : {}),
    },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

/** Fetch link previews for a text */
export async function fetchLinkPreviews(text: string): Promise<any[]> {
  const res = await fetch('/__nk_comm/link-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.previews || [];
}

// ── Calls ────────────────────────────────────────────────────────

/** Listen for incoming calls */
export function onIncomingCall(handler: (call: any) => void): () => void {
  addHandler('call:incoming', handler);
  return () => removeHandler('call:incoming', handler);
}

/** Listen for call state changes */
export function onCallStateChanged(handler: (data: { callId: string; state: string; endReason?: string }) => void): () => void {
  addHandler('call:state-changed', handler);
  return () => removeHandler('call:state-changed', handler);
}

/** Listen for participants joining a call */
export function onParticipantJoined(handler: (data: { callId: string; participant: any }) => void): () => void {
  addHandler('call:participant-joined', handler);
  return () => removeHandler('call:participant-joined', handler);
}

/** Listen for participants leaving a call */
export function onParticipantLeft(handler: (data: { callId: string; userId: string }) => void): () => void {
  addHandler('call:participant-left', handler);
  return () => removeHandler('call:participant-left', handler);
}

/** Listen for media changes (mute/unmute/screenshare) */
export function onMediaChanged(handler: (data: { callId: string; userId: string; audio?: boolean; video?: boolean; screenShare?: boolean }) => void): () => void {
  addHandler('call:media-changed', handler);
  return () => removeHandler('call:media-changed', handler);
}

/** Initiate an audio or video call */
export function initiateCall(conversationId: string, type: 'audio' | 'video', calleeIds: string[], caller?: {
  callerName?: string; callerInitials?: string; callerColor?: string;
}): void {
  emit('call:initiate', { conversationId, type, calleeIds, ...caller });
}

/** Respond to an incoming call */
export function respondToCall(callId: string, action: 'accept' | 'reject'): void {
  emit('call:respond', { callId, action });
}

/** Hang up an active call */
export function hangup(callId: string, reason: string = 'completed', duration?: string | null): void {
  emit('call:hangup', { callId, reason, ...(duration ? { duration } : {}) });
}

/** Toggle audio/video/screenshare during a call */
export function toggleMedia(callId: string, opts: { audio?: boolean; video?: boolean; screenShare?: boolean }): void {
  emit('call:media-toggle', { callId, ...opts });
}

// ── WebRTC Signaling ─────────────────────────────────────────────

/** Send SDP offer to a peer */
export function sendOffer(callId: string, toUserId: string, sdp: string): void {
  emit('signal:offer', { callId, fromUserId: '', toUserId, type: 'offer', sdp });
}

/** Send SDP answer to a peer */
export function sendAnswer(callId: string, toUserId: string, sdp: string): void {
  emit('signal:answer', { callId, fromUserId: '', toUserId, type: 'answer', sdp });
}

/** Send ICE candidate to a peer */
export function sendIceCandidate(callId: string, toUserId: string, candidate: string, sdpMLineIndex: number | null, sdpMid: string | null): void {
  emit('signal:ice-candidate', { callId, fromUserId: '', toUserId, candidate, sdpMLineIndex, sdpMid });
}

/** Listen for SDP offers from peers */
export function onSignalOffer(handler: (data: { callId: string; fromUserId: string; sdp: string }) => void): () => void {
  addHandler('signal:offer', handler);
  return () => removeHandler('signal:offer', handler);
}

/** Listen for SDP answers from peers */
export function onSignalAnswer(handler: (data: { callId: string; fromUserId: string; sdp: string }) => void): () => void {
  addHandler('signal:answer', handler);
  return () => removeHandler('signal:answer', handler);
}

/** Listen for ICE candidates from peers */
export function onIceCandidate(handler: (data: { callId: string; fromUserId: string; candidate: string; sdpMLineIndex: number | null; sdpMid: string | null }) => void): () => void {
  addHandler('signal:ice-candidate', handler);
  return () => removeHandler('signal:ice-candidate', handler);
}

/** Disconnect from communication socket */
export function disconnect(): void {
  _sessionId++; // invalidate any in-flight connectChat() — they will self-abort
  if (_socket) {
    _socket.disconnect();
    _socket = null;
    // Replace (not just clear) so old socket's sessionHandlers closure points
    // to the now-abandoned Map and cannot dispatch to new-session handlers.
    _handlers = new Map();
  }
  _connectingPromise = null;
}

/** Check if connected */
export function isConnected(): boolean {
  return _socket?.connected ?? false;
}
