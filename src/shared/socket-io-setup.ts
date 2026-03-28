import { createRequire } from 'module';
import { pathToFileURL } from 'url';

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
        if (!mod.socket) return;

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

        const cleanup = mod.socket({ on, push, room, params, headers: socket.handshake.headers, locale, socket });
        socket.on('disconnect', () => { if (typeof cleanup === 'function') cleanup(); });
      } catch (err) {
        console.error(`[LumenJS] Socket handler error for ${route.path}:`, err);
      }
    });
  }

  return io;
}
