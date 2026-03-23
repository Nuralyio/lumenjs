import type { PresenceStatus, Call, CallState, CallEndReason, CallParticipant, KeyBundle, PreKey } from './types.js';

// ── Presence ──────────────────────────────────────────────────────

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
  lastSeen: string;
  socketIds: Set<string>;
}

// ── Typing ────────────────────────────────────────────────────────

interface TypingEntry {
  userId: string;
  timer: ReturnType<typeof setTimeout>;
}

// ── CommunicationStore ────────────────────────────────────────────

const TYPING_TIMEOUT_MS = 5000;

export class CommunicationStore {
  /** userId → presence info */
  private presence = new Map<string, PresenceEntry>();
  /** conversationId → map of userId → typing timer */
  private typing = new Map<string, Map<string, TypingEntry>>();
  /** callId → active call */
  private calls = new Map<string, Call>();
  /** userId → set of socket IDs (multi-device support) */
  private userSockets = new Map<string, Set<string>>();
  /** socketId → userId (reverse lookup) */
  private socketUser = new Map<string, string>();
  /** userId → public key bundle for E2E encryption */
  private keyBundles = new Map<string, KeyBundle>();
  /** conversationId → set of user IDs currently in the room */
  private conversationMembers = new Map<string, Set<string>>();

  // ── User-Socket Mapping ───────────────────────────────────────

  mapUserSocket(userId: string, socketId: string): void {
    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(socketId);
    this.socketUser.set(socketId, userId);
  }

  unmapUserSocket(socketId: string): string | undefined {
    const userId = this.socketUser.get(socketId);
    if (!userId) return undefined;
    this.socketUser.delete(socketId);
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) this.userSockets.delete(userId);
    }
    return userId;
  }

  getSocketsForUser(userId: string): Set<string> {
    return this.userSockets.get(userId) || new Set();
  }

  getUserForSocket(socketId: string): string | undefined {
    return this.socketUser.get(socketId);
  }

  isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return !!sockets && sockets.size > 0;
  }

  // ── Presence ──────────────────────────────────────────────────

  setPresence(userId: string, status: PresenceStatus): PresenceEntry {
    const existing = this.presence.get(userId);
    const entry: PresenceEntry = {
      userId,
      status,
      lastSeen: new Date().toISOString(),
      socketIds: existing?.socketIds || this.getSocketsForUser(userId),
    };
    this.presence.set(userId, entry);
    return entry;
  }

  getPresence(userId: string): PresenceEntry | undefined {
    return this.presence.get(userId);
  }

  removePresence(userId: string): void {
    this.presence.delete(userId);
  }

  // ── Typing ────────────────────────────────────────────────────

  setTyping(conversationId: string, userId: string, onExpire: () => void): void {
    let convTyping = this.typing.get(conversationId);
    if (!convTyping) {
      convTyping = new Map();
      this.typing.set(conversationId, convTyping);
    }

    const existing = convTyping.get(userId);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      this.clearTyping(conversationId, userId);
      onExpire();
    }, TYPING_TIMEOUT_MS);

    convTyping.set(userId, { userId, timer });
  }

  clearTyping(conversationId: string, userId: string): void {
    const convTyping = this.typing.get(conversationId);
    if (!convTyping) return;
    const entry = convTyping.get(userId);
    if (entry) {
      clearTimeout(entry.timer);
      convTyping.delete(userId);
    }
    if (convTyping.size === 0) this.typing.delete(conversationId);
  }

  clearAllTypingForUser(userId: string): string[] {
    const cleared: string[] = [];
    for (const [convId, convTyping] of this.typing) {
      if (convTyping.has(userId)) {
        const entry = convTyping.get(userId)!;
        clearTimeout(entry.timer);
        convTyping.delete(userId);
        cleared.push(convId);
      }
      if (convTyping.size === 0) this.typing.delete(convId);
    }
    return cleared;
  }

  getTypingUsers(conversationId: string): string[] {
    const convTyping = this.typing.get(conversationId);
    if (!convTyping) return [];
    return Array.from(convTyping.keys());
  }

  // ── Calls ─────────────────────────────────────────────────────

  addCall(call: Call): void {
    this.calls.set(call.id, call);
  }

  getCall(callId: string): Call | undefined {
    return this.calls.get(callId);
  }

  updateCallState(callId: string, state: CallState, endReason?: CallEndReason): Call | undefined {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    call.state = state;
    if (endReason) call.endReason = endReason;
    if (state === 'connected' && !call.answeredAt) call.answeredAt = new Date().toISOString();
    if (state === 'ended') call.endedAt = new Date().toISOString();
    return call;
  }

  addCallParticipant(callId: string, participant: CallParticipant): Call | undefined {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    const existing = call.participants.findIndex(p => p.userId === participant.userId);
    if (existing >= 0) call.participants[existing] = participant;
    else call.participants.push(participant);
    return call;
  }

  removeCallParticipant(callId: string, userId: string): Call | undefined {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    call.participants = call.participants.filter(p => p.userId !== userId);
    return call;
  }

  removeCall(callId: string): void {
    this.calls.delete(callId);
  }

  getActiveCallForUser(userId: string): Call | undefined {
    for (const call of this.calls.values()) {
      if (call.state === 'ended') continue;
      if (call.callerId === userId || call.calleeIds.includes(userId)) return call;
    }
    return undefined;
  }
  // ── Conversation Membership ─────────────────────────────────────

  addConversationMember(conversationId: string, userId: string): void {
    let members = this.conversationMembers.get(conversationId);
    if (!members) {
      members = new Set();
      this.conversationMembers.set(conversationId, members);
    }
    members.add(userId);
  }

  removeConversationMember(conversationId: string, userId: string): void {
    const members = this.conversationMembers.get(conversationId);
    if (!members) return;
    members.delete(userId);
    if (members.size === 0) this.conversationMembers.delete(conversationId);
  }

  getConversationMembers(conversationId: string): Set<string> {
    return this.conversationMembers.get(conversationId) || new Set();
  }

  removeUserFromAllConversations(userId: string): string[] {
    const removed: string[] = [];
    for (const [convId, members] of this.conversationMembers) {
      if (members.has(userId)) {
        members.delete(userId);
        removed.push(convId);
      }
      if (members.size === 0) this.conversationMembers.delete(convId);
    }
    return removed;
  }

  // ── E2E Encryption Key Bundles ──────────────────────────────────

  setKeyBundle(userId: string, bundle: KeyBundle): void {
    this.keyBundles.set(userId, bundle);
  }

  getKeyBundle(userId: string): KeyBundle | undefined {
    return this.keyBundles.get(userId);
  }

  /** Pop one one-time pre-key (consumed once per session setup). Returns undefined if depleted. */
  popOneTimePreKey(userId: string): PreKey | undefined {
    const bundle = this.keyBundles.get(userId);
    if (!bundle || bundle.oneTimePreKeys.length === 0) return undefined;
    return bundle.oneTimePreKeys.shift();
  }

  /** Check how many one-time pre-keys remain */
  getOneTimePreKeyCount(userId: string): number {
    const bundle = this.keyBundles.get(userId);
    return bundle?.oneTimePreKeys.length || 0;
  }

  removeKeyBundle(userId: string): void {
    this.keyBundles.delete(userId);
  }
}

// ── Singleton ─────────────────────────────────────────────────────

let _instance: CommunicationStore | null = null;

export function useCommunicationStore(): CommunicationStore {
  if (!_instance) _instance = new CommunicationStore();
  return _instance;
}
