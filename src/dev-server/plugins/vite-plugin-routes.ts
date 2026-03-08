import { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';
import { dirToLayoutTagName, fileHasLoader, fileHasSubscribe, filePathToRoute, filePathToTagName } from '../../shared/utils.js';

export interface RouteEntry {
  path: string;
  componentPath: string;
  tagName: string;
}

export interface LayoutEntry {
  /** Relative directory within pages/ ('' for root) */
  dir: string;
  filePath: string;
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
 *   pages/_layout.ts     → layout wrapping all pages in directory + subdirectories
 */
export function lumenRoutesPlugin(pagesDir: string): Plugin {
  function scanLayouts(): LayoutEntry[] {
    if (!fs.existsSync(pagesDir)) return [];
    const layouts: LayoutEntry[] = [];
    walkForLayouts(pagesDir, '', layouts);
    return layouts;
  }

  function walkForLayouts(baseDir: string, relativePath: string, layouts: LayoutEntry[]) {
    const fullDir = path.join(baseDir, relativePath);
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && /^_layout\.(ts|js)$/.test(entry.name)) {
        const filePath = path.join(fullDir, entry.name);
        const tagName = dirToLayoutTagName(relativePath);
        layouts.push({ dir: relativePath.replace(/\\/g, '/'), filePath, tagName });
      }
      if (entry.isDirectory()) {
        walkForLayouts(baseDir, path.join(relativePath, entry.name), layouts);
      }
    }
  }

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

  /** Build the layout chain for a route based on its file path within pages/ */
  function getLayoutChain(componentPath: string, layouts: LayoutEntry[]): LayoutEntry[] {
    const relativeToPages = path.relative(pagesDir, componentPath).replace(/\\/g, '/');
    const dirParts = path.dirname(relativeToPages).split('/').filter(p => p && p !== '.');

    const chain: LayoutEntry[] = [];
    const rootLayout = layouts.find(l => l.dir === '');
    if (rootLayout) chain.push(rootLayout);

    let currentDir = '';
    for (const part of dirParts) {
      currentDir = currentDir ? `${currentDir}/${part}` : part;
      const layout = layouts.find(l => l.dir === currentDir);
      if (layout) chain.push(layout);
    }

    return chain;
  }

  return {
    name: 'lumenjs-routes',
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        const routes = scanPages();
        const layouts = scanLayouts();

        const routeArray = routes
          .map(r => {
            const hasLoader = fileHasLoader(r.componentPath);
            const hasSubscribe = fileHasSubscribe(r.componentPath);
            const componentPath = r.componentPath.replace(/\\/g, '/');
            const chain = getLayoutChain(r.componentPath, layouts);

            let layoutsStr = '';
            if (chain.length > 0) {
              const items = chain.map(l => {
                const lHasLoader = fileHasLoader(l.filePath);
                const lHasSubscribe = fileHasSubscribe(l.filePath);
                const lPath = l.filePath.replace(/\\/g, '/');
                return `{ tagName: ${JSON.stringify(l.tagName)}, loaderPath: ${JSON.stringify(l.dir)}${lHasLoader ? ', hasLoader: true' : ''}${lHasSubscribe ? ', hasSubscribe: true' : ''}, load: () => import('${lPath}') }`;
              });
              layoutsStr = `, layouts: [${items.join(', ')}]`;
            }

            return `  { path: ${JSON.stringify(r.path)}, tagName: ${JSON.stringify(r.tagName)}${hasLoader ? ', hasLoader: true' : ''}${hasSubscribe ? ', hasSubscribe: true' : ''}, load: () => import('${componentPath}')${layoutsStr} }`;
          })
          .join(',\n');

        return `export const routes = [\n${routeArray}\n];\n`;
      }
    },
    configureServer(server) {
      // Full-reload when route structure changes (file added/removed)
      let lastRoutes = JSON.stringify(scanPages().map(r => r.path));
      let lastLayouts = JSON.stringify(scanLayouts().map(l => l.dir));

      const checkReload = () => {
        const newRoutes = JSON.stringify(scanPages().map(r => r.path));
        const newLayouts = JSON.stringify(scanLayouts().map(l => l.dir));
        if (newRoutes !== lastRoutes || newLayouts !== lastLayouts) {
          lastRoutes = newRoutes;
          lastLayouts = newLayouts;
          const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: 'full-reload' });
          }
        }
      };

      server.watcher.on('add', (file) => {
        if (!file.startsWith(pagesDir)) return;
        checkReload();
      });

      server.watcher.on('unlink', (file) => {
        if (!file.startsWith(pagesDir)) return;
        checkReload();
      });
    }
  };
}
