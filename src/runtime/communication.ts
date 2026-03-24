/**
 * Client-side communication SDK.
 * Connects to the server via Socket.io and provides a clean API for chat, typing, and presence.
 */

let _socket: any = null;
let _handlers: Map<string, Set<Function>> = new Map();

function emit(event: string, data: any): void {
  if (!_socket) throw new Error('Communication not connected. Call connectChat() first.');
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
 * Must be called before using any other functions.
 */
export async function connectChat(params?: Record<string, string>): Promise<void> {
  if (_socket) return;
  const { io } = await import('socket.io-client');
  _socket = io('/nk/messages', {
    path: '/__nk_socketio/',
    query: { ...params, __params: JSON.stringify(params || {}) },
  });

  _socket.on('nk:data', (data: any) => {
    if (data?.event) {
      const handlers = _handlers.get(data.event);
      if (handlers) {
        for (const h of handlers) h(data.data);
      }
    }
  });
}

/** Join a conversation room to receive messages */
export function joinConversation(conversationId: string): void {
  emit('conversation:join', { conversationId });
}

/** Leave a conversation room */
export function leaveConversation(conversationId: string): void {
  emit('conversation:leave', { conversationId });
}

/** Send a message */
export function sendMessage(conversationId: string, content: string, type: string = 'text'): void {
  emit('message:send', { conversationId, content, type });
}

/** Mark a message as read */
export function markRead(conversationId: string, messageId: string): void {
  emit('message:read', { conversationId, messageId });
}

/** Start typing indicator */
export function startTyping(conversationId: string): void {
  emit('typing:start', { conversationId });
}

/** Stop typing indicator */
export function stopTyping(conversationId: string): void {
  emit('typing:stop', { conversationId });
}

/** Update presence status */
export function updatePresence(status: 'online' | 'offline' | 'away' | 'busy'): void {
  emit('presence:update', { status });
}

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

/** Listen for read receipts */
export function onReadReceipt(handler: (data: any) => void): () => void {
  addHandler('read-receipt:update', handler);
  return () => removeHandler('read-receipt:update', handler);
}

// ── Calls ─────────────────────────────────────────────────────────

/** Listen for incoming calls */
export function onIncomingCall(handler: (call: any) => void): () => void {
  addHandler('call:incoming', handler);
  return () => removeHandler('call:incoming', handler);
}

/** Listen for call state changes (initiating, ringing, connecting, connected, ended) */
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
export function initiateCall(conversationId: string, type: 'audio' | 'video', calleeIds: string[]): void {
  emit('call:initiate', { conversationId, type, calleeIds });
}

/** Respond to an incoming call */
export function respondToCall(callId: string, action: 'accept' | 'reject'): void {
  emit('call:respond', { callId, action });
}

/** Hang up an active call */
export function hangup(callId: string, reason: string = 'completed'): void {
  emit('call:hangup', { callId, reason });
}

/** Toggle audio/video/screenshare during a call */
export function toggleMedia(callId: string, opts: { audio?: boolean; video?: boolean; screenShare?: boolean }): void {
  emit('call:media-toggle', { callId, ...opts });
}

// ── WebRTC Signaling ──────────────────────────────────────────────

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
  if (_socket) {
    _socket.disconnect();
    _socket = null;
    _handlers.clear();
  }
}

/** Check if connected */
export function isConnected(): boolean {
  return _socket?.connected ?? false;
}
