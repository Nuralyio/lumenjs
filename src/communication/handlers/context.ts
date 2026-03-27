import type { CommunicationConfig } from '../types.js';
import type { CommunicationStore } from '../store.js';
import type { LumenDb } from '../../db/index.js';
import type { StorageAdapter } from '../../storage/adapters/types.js';

/** Context passed to every handler from the socket connection */
export interface HandlerContext {
  userId: string;
  store: CommunicationStore;
  /** Resolved communication config */
  config: CommunicationConfig;
  /** Emit data to the current socket */
  push: (data: any) => void;
  /** Broadcast to all sockets in a room */
  broadcastAll: (room: string, data: any) => void;
  /** Broadcast to all sockets in a room except the sender */
  broadcast: (room: string, data: any) => void;
  /** Join a socket room */
  joinRoom: (room: string) => void;
  /** Leave a socket room */
  leaveRoom: (room: string) => void;
  /** Emit data to all sockets for a specific user */
  emitToUser?: (userId: string, data: any) => void;
  /** LumenJS database instance (optional — only if app has DB set up) */
  db?: LumenDb;
  /** Storage adapter for file uploads (optional — only if storage is configured) */
  storage?: StorageAdapter;
}
