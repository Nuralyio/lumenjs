import type { Call, CallType, CallEndReason, CallParticipant, SignalOffer, SignalIceCandidate } from './types.js';
import type { CommunicationStore } from './store.js';

/** Context for signaling handlers */
export interface SignalingContext {
  userId: string;
  store: CommunicationStore;
  /** Emit to a specific socket by ID */
  emitToSocket: (socketId: string, data: any) => void;
  /** Broadcast to all sockets in a room */
  broadcastAll: (room: string, data: any) => void;
}

/** Emit data to all sockets belonging to a user */
function emitToUser(ctx: SignalingContext, targetUserId: string, data: any): void {
  const sockets = ctx.store.getSocketsForUser(targetUserId);
  for (const sid of sockets) {
    ctx.emitToSocket(sid, data);
  }
}

// ── Call Lifecycle ───────────────────────────────────────────────

export function handleCallInitiate(
  ctx: SignalingContext,
  data: { conversationId: string; type: CallType; calleeIds: string[] },
): void {
  // Check if caller is already in a call
  const existingCall = ctx.store.getActiveCallForUser(ctx.userId);
  if (existingCall) {
    emitToUser(ctx, ctx.userId, {
      event: 'call:state-changed',
      data: { callId: existingCall.id, state: existingCall.state, error: 'already_in_call' },
    });
    return;
  }

  const callId = crypto.randomUUID();
  const now = new Date().toISOString();

  const call: Call = {
    id: callId,
    conversationId: data.conversationId,
    type: data.type,
    state: 'initiating',
    callerId: ctx.userId,
    calleeIds: data.calleeIds,
    startedAt: now,
    participants: [{
      userId: ctx.userId,
      joinedAt: now,
      audioMuted: false,
      videoMuted: data.type === 'audio',
      screenSharing: false,
    }],
  };

  ctx.store.addCall(call);

  // Notify caller that call is initiating
  emitToUser(ctx, ctx.userId, {
    event: 'call:state-changed',
    data: { callId, state: 'initiating' },
  });

  // Notify each callee with incoming call
  for (const calleeId of data.calleeIds) {
    // Check if callee is busy
    const calleeActiveCall = ctx.store.getActiveCallForUser(calleeId);
    if (calleeActiveCall) {
      emitToUser(ctx, ctx.userId, {
        event: 'call:state-changed',
        data: { callId, state: 'ended', endReason: 'busy' },
      });
      ctx.store.updateCallState(callId, 'ended', 'busy');
      ctx.store.removeCall(callId);
      return;
    }

    emitToUser(ctx, calleeId, { event: 'call:incoming', data: call });
  }

  // Update state to ringing
  ctx.store.updateCallState(callId, 'ringing');
}

export function handleCallRespond(
  ctx: SignalingContext,
  data: { callId: string; action: 'accept' | 'reject' },
): void {
  const call = ctx.store.getCall(data.callId);
  if (!call) return;

  if (data.action === 'reject') {
    ctx.store.updateCallState(data.callId, 'ended', 'rejected');

    // Notify all parties
    emitToUser(ctx, call.callerId, {
      event: 'call:state-changed',
      data: { callId: data.callId, state: 'ended', endReason: 'rejected' },
    });
    emitToUser(ctx, ctx.userId, {
      event: 'call:state-changed',
      data: { callId: data.callId, state: 'ended', endReason: 'rejected' },
    });

    ctx.store.removeCall(data.callId);
    return;
  }

  // Accept — add callee as participant
  const now = new Date().toISOString();
  const participant: CallParticipant = {
    userId: ctx.userId,
    joinedAt: now,
    audioMuted: false,
    videoMuted: call.type === 'audio',
    screenSharing: false,
  };

  ctx.store.addCallParticipant(data.callId, participant);
  ctx.store.updateCallState(data.callId, 'connecting');

  // Notify caller that callee accepted
  emitToUser(ctx, call.callerId, {
    event: 'call:participant-joined',
    data: { callId: data.callId, participant },
  });
  emitToUser(ctx, call.callerId, {
    event: 'call:state-changed',
    data: { callId: data.callId, state: 'connecting' },
  });

  // Notify callee of connecting state
  emitToUser(ctx, ctx.userId, {
    event: 'call:state-changed',
    data: { callId: data.callId, state: 'connecting' },
  });
}

export function handleCallHangup(
  ctx: SignalingContext,
  data: { callId: string; reason: CallEndReason },
): void {
  const call = ctx.store.getCall(data.callId);
  if (!call) return;

  // Remove the user who hung up
  ctx.store.removeCallParticipant(data.callId, ctx.userId);

  // Notify other participants
  for (const p of call.participants) {
    if (p.userId === ctx.userId) continue;
    emitToUser(ctx, p.userId, {
      event: 'call:participant-left',
      data: { callId: data.callId, userId: ctx.userId },
    });
  }

  // Also notify caller/callees who may not be in participants yet (e.g., still ringing)
  const allUsers = new Set([call.callerId, ...call.calleeIds]);
  allUsers.delete(ctx.userId);

  // If no participants left (or only one), end the call
  const remainingParticipants = call.participants.filter(p => p.userId !== ctx.userId);
  if (remainingParticipants.length <= 1) {
    ctx.store.updateCallState(data.callId, 'ended', data.reason);
    for (const uid of allUsers) {
      emitToUser(ctx, uid, {
        event: 'call:state-changed',
        data: { callId: data.callId, state: 'ended', endReason: data.reason },
      });
    }
    ctx.store.removeCall(data.callId);
  }
}

export function handleCallMediaToggle(
  ctx: SignalingContext,
  data: { callId: string; audio?: boolean; video?: boolean; screenShare?: boolean },
): void {
  const call = ctx.store.getCall(data.callId);
  if (!call) return;

  const participant = call.participants.find(p => p.userId === ctx.userId);
  if (!participant) return;

  if (data.audio !== undefined) participant.audioMuted = !data.audio;
  if (data.video !== undefined) participant.videoMuted = !data.video;
  if (data.screenShare !== undefined) participant.screenSharing = data.screenShare;

  // Notify all other participants
  for (const p of call.participants) {
    if (p.userId === ctx.userId) continue;
    emitToUser(ctx, p.userId, {
      event: 'call:media-changed',
      data: {
        callId: data.callId,
        userId: ctx.userId,
        audio: data.audio,
        video: data.video,
        screenShare: data.screenShare,
      },
    });
  }
}

// ── WebRTC Signal Relay ─────────────────────────────────────────

export function handleSignalOffer(ctx: SignalingContext, data: SignalOffer): void {
  emitToUser(ctx, data.toUserId, { event: 'signal:offer', data });
}

export function handleSignalAnswer(ctx: SignalingContext, data: SignalOffer): void {
  emitToUser(ctx, data.toUserId, { event: 'signal:answer', data });
}

export function handleSignalIceCandidate(ctx: SignalingContext, data: SignalIceCandidate): void {
  emitToUser(ctx, data.toUserId, { event: 'signal:ice-candidate', data });
}
