import { Plugin, ViteDevServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileHasSocket, filePathToRoute } from '../../shared/utils.js';
import type { SocketRoute } from '../../shared/socket-io-setup.js';

export function lumenSocketIOPlugin(pagesDir: string): Plugin {
  return {
    name: 'lumenjs-socketio',
    configureServer(server: ViteDevServer) {
      if (!server.httpServer) return;

      import('../../shared/socket-io-setup.js').then(({ setupSocketIO }) => {
        const routes = scanSocketRoutes(pagesDir);
        setupSocketIO({
          httpServer: server.httpServer!,
          loadModule: (fp) => server.ssrLoadModule(fp),
          routes,
          projectDir: path.dirname(pagesDir),
        }).catch((err: any) => {
          console.warn('[LumenJS] Socket.IO setup failed:', err.message);
          console.warn('[LumenJS] Make sure socket.io is installed: lumenjs add socketio');
        });
      }).catch((err: any) => {
        console.warn('[LumenJS] Socket.IO plugin load failed:', err.message);
      });
    },
  };
}

function scanSocketRoutes(pagesDir: string): SocketRoute[] {
  const routes: SocketRoute[] = [];
  if (!fs.existsSync(pagesDir)) return routes;
  walkDir(pagesDir, '', routes, pagesDir);
  return routes;
}

function walkDir(baseDir: string, relativePath: string, routes: SocketRoute[], pagesDir: string) {
  const fullDir = path.join(baseDir, relativePath);
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      walkDir(baseDir, entryRelative, routes, pagesDir);
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
      const filePath = path.join(pagesDir, entryRelative);
      const hasSocket = fileHasSocket(filePath);
      if (hasSocket) {
        const routePath = filePathToRoute(entryRelative);
        routes.push({ path: routePath, hasSocket: true, filePath });
      }
    }
  }
}
