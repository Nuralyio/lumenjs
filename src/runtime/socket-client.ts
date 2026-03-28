import { getI18nConfig, getLocale } from './i18n.js';

const connections = new Map<string, any>();

export async function connectSocket(routePath: string, params: Record<string, string>): Promise<any> {
  const { io } = await import('socket.io-client');
  const ns = `/nk${routePath === '/' ? '/index' : routePath}`;
  const query: Record<string, string> = {};
  if (Object.keys(params).length > 0) {
    query.__params = JSON.stringify(params);
  }
  try {
    const config = getI18nConfig();
    if (config) {
      query.__locale = getLocale();
    }
  } catch {}

  // Disconnect existing socket for this route to prevent leaks
  const existing = connections.get(routePath);
  if (existing) existing.disconnect();

  const socket = io(ns, { path: '/__nk_socketio/', query });
  connections.set(routePath, socket);
  return socket;
}

export function disconnectAllSockets(): void {
  for (const [, socket] of connections) {
    socket.disconnect();
  }
  connections.clear();
}
