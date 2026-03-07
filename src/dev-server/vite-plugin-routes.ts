import { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

export interface RouteEntry {
  path: string;
  componentPath: string;
  tagName: string;
}

const VIRTUAL_MODULE_ID = 'virtual:lumenjs-routes';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

/**
 * Scans pages/ directory and generates a virtual route manifest module.
 * Supports:
 *   pages/index.ts       → /
 *   pages/about.ts       → /about
 *   pages/blog/[slug].ts → /blog/:slug
 */
export function lumenRoutesPlugin(pagesDir: string): Plugin {
  function scanPages(): RouteEntry[] {
    if (!fs.existsSync(pagesDir)) return [];

    const routes: RouteEntry[] = [];
    walkDir(pagesDir, '', routes);
    // Sort: static → dynamic → catch-all
    routes.sort((a, b) => {
      const aCatchAll = a.path.includes(':...');
      const bCatchAll = b.path.includes(':...');
      if (aCatchAll !== bCatchAll) return aCatchAll ? 1 : -1;
      const aDynamic = a.path.includes(':');
      const bDynamic = b.path.includes(':');
      if (aDynamic !== bDynamic) return aDynamic ? 1 : -1;
      return a.path.localeCompare(b.path);
    });
    return routes;
  }

  function walkDir(baseDir: string, relativePath: string, routes: RouteEntry[]) {
    const fullDir = path.join(baseDir, relativePath);
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelative = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        walkDir(baseDir, entryRelative, routes);
      } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
        const routePath = filePathToRoute(entryRelative);
        const componentPath = path.join(pagesDir, entryRelative);
        const tagName = filePathToTagName(entryRelative);
        routes.push({ path: routePath, componentPath, tagName });
      }
    }
  }

  function filePathToRoute(filePath: string): string {
    let route = filePath
      .replace(/\.(ts|js)$/, '')
      .replace(/\\/g, '/')
      .replace(/\[\.\.\.([^\]]+)\]/g, ':...$1') // [...slug] → :...slug (catch-all)
      .replace(/\[([^\]]+)\]/g, ':$1');          // [slug] → :slug

    if (route === 'index' || route.endsWith('/index')) {
      route = route.slice(0, -5).replace(/\/$/, '') || '/';
    }

    return route.startsWith('/') ? route : '/' + route;
  }

  function filePathToTagName(filePath: string): string {
    const name = filePath
      .replace(/\.(ts|js)$/, '')
      .replace(/\\/g, '-')
      .replace(/\//g, '-')
      .replace(/\[\.\.\.([^\]]+)\]/g, '$1')
      .replace(/\[([^\]]+)\]/g, '$1')
      .toLowerCase();
    return `page-${name}`;
  }

  function fileHasLoader(filePath: string): boolean {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return /export\s+(async\s+)?function\s+loader\s*\(/.test(content);
    } catch { return false; }
  }

  return {
    name: 'lumenjs-routes',
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        const routes = scanPages();
        const routeArray = routes
          .map(r => {
            const hasLoader = fileHasLoader(r.componentPath);
            const componentPath = r.componentPath.replace(/\\/g, '/');
            return `  { path: ${JSON.stringify(r.path)}, tagName: ${JSON.stringify(r.tagName)}${hasLoader ? ', hasLoader: true' : ''}, load: () => import('${componentPath}') }`;
          })
          .join(',\n');

        return `export const routes = [\n${routeArray}\n];\n`;
      }
    },
    configureServer(server) {
      // Only full-reload when route structure changes (file added/removed), not on content edits
      let lastRoutes = JSON.stringify(scanPages().map(r => r.path));

      server.watcher.on('add', (file) => {
        if (!file.startsWith(pagesDir)) return;
        const newRoutes = JSON.stringify(scanPages().map(r => r.path));
        if (newRoutes !== lastRoutes) {
          lastRoutes = newRoutes;
          const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: 'full-reload' });
          }
        }
      });

      server.watcher.on('unlink', (file) => {
        if (!file.startsWith(pagesDir)) return;
        const newRoutes = JSON.stringify(scanPages().map(r => r.path));
        if (newRoutes !== lastRoutes) {
          lastRoutes = newRoutes;
          const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: 'full-reload' });
          }
        }
      });
    }
  };
}
