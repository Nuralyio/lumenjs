// ── Configuration ─────────────────────────────────────────────────

export interface CommunicationConfig {
  /** Socket.io namespace for communication events (default: '/nk/communication') */
  namespace?: string;
  /** WebRTC ICE/TURN server configuration */
  iceServers?: RTCIceServerConfig[];
  /** Default media constraints for calls */
  mediaConstraints?: MediaConstraintDefaults;
  /** Maximum message length in characters */
  maxMessageLength?: number;
  /** Enable read receipts globally */
  readReceipts?: boolean;
  /** Enable typing indicators globally */
  typingIndicators?: boolean;
  /** Message history page size */
  pageSize?: number;
  /** End-to-end encryption settings */
  encryption?: EncryptionConfig;
  /** Rate limiting for message sends */
  rateLimit?: RateLimitConfig;
  /** File upload constraints */
  fileUpload?: FileUploadConfig;
  /** Typing indicator timeout in ms. Default: 5000 */
  typingTimeoutMs?: number;
  /** Message retention in days. 0 = keep forever. Default: 0 */
  messageRetentionDays?: number;
  /** Socket reconnection config */
  reconnection?: ReconnectionConfig;
}

export interface RateLimitConfig {
  /** Max messages per window. Default: 30 */
  maxMessages: number;
  /** Window duration in seconds. Default: 60 */
  windowSeconds: number;
}

export interface FileUploadConfig {
  /** Maximum file size in bytes. Default: 25MB (26214400) */
  maxFileSize: number;
  /** Maximum attachments per message. Default: 10 */
  maxAttachmentsPerMessage: number;
  /** Allowed MIME types. Empty array = allow all. Default: common image/video/document types */
  allowedMimeTypes?: string[];
}

export interface ReconnectionConfig {
  /** Max reconnection attempts. Default: 10 */
  maxRetries: number;
  /** Base delay between retries in ms. Default: 1000 */
  baseDelayMs: number;
  /** Max delay cap in ms. Default: 30000 */
  maxDelayMs: number;
}

export interface EncryptionConfig {
  /** Enable E2E encryption for messages */
  enabled: boolean;
  /** How often clients should rotate pre-keys (ms). Default: 7 days */
  keyRotationInterval?: number;
  /** Number of one-time pre-keys each client should upload. Default: 100 */
  oneTimePreKeyCount?: number;
}

export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface MediaConstraintDefaults {
  audio?: boolean | MediaTrackConstraintSet;
  video?: boolean | MediaTrackConstraintSet;
}

export interface MediaTrackConstraintSet {
  width?: number | { min?: number; max?: number; ideal?: number };
  height?: number | { min?: number; max?: number; ideal?: number };
  frameRate?: number | { min?: number; max?: number; ideal?: number };
  facingMode?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
}

// ── Chat ──────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  participants: Participant[];
  lastMessage?: Message;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
}

export interface Participant {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  role?: 'owner' | 'admin' | 'member';
  joinedAt: string;
  presence: PresenceStatus;
}

export type PresenceStatus = 'online' | 'offline' | 'away' | 'busy';

export interface PresenceUpdate {
  userId: string;
  status: PresenceStatus;
  lastSeen?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'file' | 'audio' | 'system';
  createdAt: string;
  updatedAt?: string;
  replyTo?: string;
  attachment?: MessageAttachment;
  status: MessageStatus;
  readBy: ReadReceipt[];
  /** Whether this message is end-to-end encrypted */
  encrypted?: boolean;
  /** Encrypted envelope — present when encrypted is true. Server stores this as opaque blob. */
  envelope?: EncryptedEnvelope;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageAttachment {
  url: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  width?: number;
  height?: number;
  /** Audio/video duration in seconds */
  duration?: number;
  thumbnailUrl?: string;
}

export interface ReadReceipt {
  userId: string;
  readAt: string;
}

export interface TypingIndicator {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface MessageForward {
  messageId: string;
  fromConversationId: string;
  toConversationId: string;
}

// ── Calls (WebRTC Signaling) ──────────────────────────────────────

export type CallType = 'audio' | 'video';

export type CallState =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended';

export type CallEndReason =
  | 'completed'
  | 'rejected'
  | 'missed'
  | 'busy'
  | 'failed'
  | 'cancelled';

export interface Call {
  id: string;
  conversationId: string;
  type: CallType;
  state: CallState;
  callerId: string;
  calleeIds: string[];
  startedAt?: string;
  answeredAt?: string;
  endedAt?: string;
  endReason?: CallEndReason;
  participants: CallParticipant[];
}

export interface CallParticipant {
  userId: string;
  joinedAt: string;
  audioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
}

export interface SignalOffer {
  callId: string;
  fromUserId: string;
  toUserId: string;
  type: 'offer' | 'answer';
  sdp: string;
  /** Indicates this offer is a renegotiation (e.g., adding a screen share track mid-call) */
  renegotiation?: boolean;
}

export interface SignalIceCandidate {
  callId: string;
  fromUserId: string;
  toUserId: string;
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
}

export interface SignalIceRestart {
  callId: string;
  fromUserId: string;
  toUserId: string;
}

export interface ConnectionQualityReport {
  callId: string;
  userId: string;
  /** Round-trip time in ms */
  rtt?: number;
  /** Packet loss percentage (0-100) */
  packetLoss?: number;
  /** Jitter in ms */
  jitter?: number;
  /** Quality level derived from metrics */
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  /** Estimated available bandwidth in kbps */
  availableBandwidth?: number;
}

export interface CallInitiate {
  conversationId: string;
  type: CallType;
  calleeIds: string[];
}

export interface CallResponse {
  callId: string;
  action: 'accept' | 'reject';
}

export interface CallHangup {
  callId: string;
  reason: CallEndReason;
}

export interface CallMediaToggle {
  callId: string;
  audio?: boolean;
  video?: boolean;
  screenShare?: boolean;
}

// ── End-to-End Encryption ─────────────────────────────────────────

/** A single pre-key (identity, signed, or one-time) */
export interface PreKey {
  keyId: number;
  publicKey: string;
}

/** A user's public key bundle uploaded to the server */
export interface KeyBundle {
  userId: string;
  /** Long-term identity public key */
  identityKey: string;
  /** Signed pre-key (rotated periodically) */
  signedPreKey: PreKey;
  /** Signature of signedPreKey by identityKey */
  signedPreKeySignature: string;
  /** One-time pre-keys (each consumed once during session setup) */
  oneTimePreKeys: PreKey[];
  /** When this bundle was uploaded */
  uploadedAt: string;
}

/** Encrypted message envelope — server treats this as an opaque blob */
export interface EncryptedEnvelope {
  /** Sender's user ID */
  senderId: string;
  /** Recipient's user ID (for 1:1); in groups, one envelope per recipient */
  recipientId: string;
  /** Session identifier for this sender-recipient pair */
  sessionId: string;
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** 'prekey' for first message (includes key exchange), 'message' for subsequent */
  messageType: 'prekey' | 'message';
  /** Sender's identity public key (included for verification) */
  senderIdentityKey: string;
  /** Ephemeral public key (present in prekey messages for X3DH) */
  senderEphemeralKey?: string;
  /** Which one-time pre-key was used (present in prekey messages) */
  usedOneTimePreKeyId?: number;
}

/** Client requests a recipient's key bundle for session setup */
export interface KeyExchangeRequest {
  recipientId: string;
}

/** Server responds with the recipient's public keys */
export interface KeyExchangeResponse {
  recipientId: string;
  identityKey: string;
  signedPreKey: PreKey;
  signedPreKeySignature: string;
  /** One one-time pre-key (consumed — won't be returned again) */
  oneTimePreKey?: PreKey;
}

// ── Socket.io Event Map ───────────────────────────────────────────

export interface CommunicationClientEvents {
  'message:send': (data: { conversationId: string; content: string; type: Message['type']; replyTo?: string; attachment?: MessageAttachment }) => void;
  'message:read': (data: { conversationId: string; messageId: string }) => void;
  'typing:start': (data: { conversationId: string }) => void;
  'typing:stop': (data: { conversationId: string }) => void;
  'presence:update': (data: { status: PresenceStatus }) => void;
  'conversation:create': (data: { type: 'direct' | 'group'; name?: string; participantIds: string[] }) => void;
  'conversation:join': (data: { conversationId: string }) => void;
  'conversation:leave': (data: { conversationId: string }) => void;
  'conversation:archive': (data: { conversationId: string; archived: boolean }) => void;
  'conversation:mute': (data: { conversationId: string; muted: boolean }) => void;
  'conversation:pin': (data: { conversationId: string; pinned: boolean }) => void;
  'message:forward': (data: MessageForward) => void;
  'call:initiate': (data: CallInitiate) => void;
  'call:respond': (data: CallResponse) => void;
  'call:hangup': (data: CallHangup) => void;
  'call:media-toggle': (data: CallMediaToggle) => void;
  'call:add-participant': (data: { callId: string; userId: string }) => void;
  'call:remove-participant': (data: { callId: string; userId: string }) => void;
  'signal:offer': (data: SignalOffer) => void;
  'signal:answer': (data: SignalOffer) => void;
  'signal:ice-candidate': (data: SignalIceCandidate) => void;
  'signal:ice-restart': (data: SignalIceRestart) => void;
  'call:quality-report': (data: ConnectionQualityReport) => void;
  'encryption:upload-keys': (data: KeyBundle) => void;
  'encryption:request-keys': (data: KeyExchangeRequest) => void;
  'encryption:session-init': (data: { recipientId: string; sessionId: string; envelope: EncryptedEnvelope }) => void;
}

export interface CommunicationServerEvents {
  'message:new': (data: Message) => void;
  'message:updated': (data: Message) => void;
  'message:status': (data: { messageId: string; status: MessageStatus }) => void;
  'message:error': (data: { code: string; message: string }) => void;
  'typing:update': (data: TypingIndicator) => void;
  'presence:changed': (data: PresenceUpdate) => void;
  'conversation:updated': (data: Conversation) => void;
  'conversation:new': (data: Conversation) => void;
  'message:forwarded': (data: Message & { forwardedFrom?: { conversationId: string; messageId: string } }) => void;
  'read-receipt:update': (data: { conversationId: string; messageId: string; readBy: ReadReceipt }) => void;
  'call:incoming': (data: Call) => void;
  'call:state-changed': (data: { callId: string; state: CallState; endReason?: CallEndReason }) => void;
  'call:participant-joined': (data: { callId: string; participant: CallParticipant }) => void;
  'call:participant-left': (data: { callId: string; userId: string }) => void;
  'call:media-changed': (data: { callId: string; userId: string; audio?: boolean; video?: boolean; screenShare?: boolean }) => void;
  'signal:offer': (data: SignalOffer) => void;
  'signal:answer': (data: SignalOffer) => void;
  'signal:ice-candidate': (data: SignalIceCandidate) => void;
  'signal:ice-restart': (data: SignalIceRestart) => void;
  'call:quality-changed': (data: ConnectionQualityReport) => void;
  'encryption:keys-response': (data: KeyExchangeResponse) => void;
  'encryption:session-established': (data: { sessionId: string; senderId: string }) => void;
  'encryption:session-init': (data: { senderId: string; sessionId: string; envelope: EncryptedEnvelope }) => void;
  'encryption:keys-depleted': (data: { userId: string }) => void;
}

// ── Aggregate ─────────────────────────────────────────────────────

export interface NkCommunication {
  config: CommunicationConfig;
  conversations: Conversation[];
  activeCall?: Call;
  encryptionEnabled?: boolean;
}
