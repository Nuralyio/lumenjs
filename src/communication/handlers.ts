// Barrel re-export — keeps the public API identical for all existing consumers.

export type { HandlerContext } from './handlers/context.js';

export {
  handleConversationCreate,
  handleConversationJoin,
  handleConversationLeave,
  handleConversationArchive,
  handleConversationMute,
  handleConversationPin,
} from './handlers/conversation.js';

export {
  handleMessageSend,
  handleMessageRead,
  handleMessageReact,
  handleMessageEdit,
  handleMessageDelete,
  handleMessageForward,
} from './handlers/messaging.js';

export {
  handleTypingStart,
  handleTypingStop,
  handleConnect,
  handlePresenceUpdate,
  handleDisconnect,
} from './handlers/presence.js';

export { handleFileUploadRequest } from './handlers/file-upload.js';
