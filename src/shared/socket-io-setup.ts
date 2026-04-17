import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import fs from 'fs';
import path from 'path';

export interface SocketRoute {
  path: string;
  hasSocket: boolean;
  filePath: string;
}

export async function setupSocketIO(options: {
  httpServer: any;
  loadModule: (filePath: string) => Promise<any>;
  routes: SocketRoute[];
  projectDir?: string;
  authConfig?: { session: { secret: string; cookieName: string } } | null;
}): Promise<any> {
  // Resolve socket.io from the project's node_modules (not from lumenjs's own node_modules)
  let SocketIOServer: any;
  if (options.projectDir) {
    const require = createRequire(pathToFileURL(options.projectDir + '/package.json').href);
    const socketIo = require('socket.io');
    SocketIOServer = socketIo.Server || socketIo.default?.Server || socketIo;
  } else {
    const socketIo = await import('socket.io');
    SocketIOServer = socketIo.Server;
  }

  const io = new SocketIOServer(options.httpServer, {
    path: '/__nk_socketio/',
    cors: { origin: process.env.NODE_ENV === 'production' ? false : '*' },
  });

  for (const route of options.routes) {
    if (!route.hasSocket) continue;
    const ns = `/nk${route.path === '/' ? '/index' : route.path}`;

    io.of(ns).on('connection', async (socket: any) => {
      try {
        const mod = await options.loadModule(route.filePath);
        let socketFn = mod?.socket;

        // Co-located _socket.ts fallback (folder route convention)
        if (!socketFn && path.basename(route.filePath).replace(/\.(ts|js)$/, '') === 'index') {
          const dir = path.dirname(route.filePath);
          for (const ext of ['.ts', '.js']) {
            const colocated = path.join(dir, `_socket${ext}`);
            if (fs.existsSync(colocated)) {
              const socketMod = await options.loadModule(colocated);
              socketFn = socketMod?.socket;
              break;
            }
          }
        }
        if (!socketFn) return;

        const push = (data: any) => socket.emit('nk:data', data);
        const on = (event: string, handler: (...args: any[]) => void) => {
          socket.on(`nk:${event}`, handler);
        };
        const room = {
          join: (name: string) => socket.join(name),
          leave: (name: string) => socket.leave(name),
          broadcast: (name: string, data: any) => socket.to(name).emit('nk:data', data),
          broadcastAll: (name: string, data: any) => io.of(ns).to(name).emit('nk:data', data),
        };

        const params = socket.handshake.query.__params
          ? JSON.parse(socket.handshake.query.__params as string) : {};
        const locale = socket.handshake.query.__locale as string | undefined;

        // Parse user from handshake headers (same logic as loaders/subscribe)
        let user = null;
        if (options.authConfig) {
          try {
            const headers = socket.handshake.headers;
            // Try bearer token first
            const authHeader = headers.authorization;
            if (authHeader?.startsWith('Bearer ')) {
              const { verifyAccessToken } = await import('../auth/token.js');
              const tokenUser = verifyAccessToken(authHeader.slice(7), options.authConfig.session.secret);
              if (tokenUser) user = tokenUser;
            }
            // Fall back to session cookie
            if (!user && headers.cookie) {
              const { parseSessionCookie, decryptSession } = await import('../auth/session.js');
              const cookieVal = parseSessionCookie(headers.cookie, options.authConfig.session.cookieName);
              if (cookieVal) {
                const session = await decryptSession(cookieVal, options.authConfig.session.secret);
                if (session?.user) user = session.user;
              }
            }
          } catch {}
        }

        const cleanup = socketFn({ on, push, room, params, headers: socket.handshake.headers, locale, socket, user });
        socket.on('disconnect', () => { if (typeof cleanup === 'function') cleanup(); });
      } catch (err) {
        console.error(`[LumenJS] Socket handler error for ${route.path}:`, err);
      }
    });
  }

  return io;
}
