// ── Types ─────────────────────────────────────────────────────────

export type {
  // Config
  CommunicationConfig,
  RTCIceServerConfig,
  MediaConstraintDefaults,
  MediaTrackConstraintSet,

  // Chat
  Conversation,
  Participant,
  PresenceStatus,
  PresenceUpdate,
  Message,
  MessageStatus,
  MessageAttachment,
  ReadReceipt,
  TypingIndicator,
  MessageForward,

  // Calls
  CallType,
  CallState,
  CallEndReason,
  Call,
  CallParticipant,
  SignalOffer,
  SignalIceCandidate,
  SignalIceRestart,
  ConnectionQualityReport,
  CallInitiate,
  CallResponse,
  CallHangup,
  CallMediaToggle,

  // Socket Events
  CommunicationClientEvents,
  CommunicationServerEvents,

  // E2E Encryption
  EncryptionConfig,
  PreKey,
  KeyBundle,
  EncryptedEnvelope,
  KeyExchangeRequest,
  KeyExchangeResponse,

  // Aggregate
  NkCommunication,
} from './types.js';

// ── Store ─────────────────────────────────────────────────────────

export { CommunicationStore, useCommunicationStore } from './store.js';
export type { PresenceEntry } from './store.js';

// ── Handlers ──────────────────────────────────────────────────────

export type { HandlerContext } from './handlers.js';
export type { SignalingContext } from './signaling.js';
export type { EncryptionContext } from './encryption.js';

// ── Server (main entry points) ────────────────────────────────────

export { createCommunicationHandler, createCommunicationApiHandlers } from './server.js';
export type { CommunicationHandlerOptions } from './server.js';

// ── Schema ────────────────────────────────────────────────────────

export { ensureCommunicationTables } from './schema.js';
