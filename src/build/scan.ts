import fs from 'fs';
import path from 'path';
import { filePathToRoute, fileHasLoader, fileHasSubscribe, fileHasSocket } from '../shared/utils.js';

/** Read a page file once and check all flags from the same content. */
function analyzePageFile(filePath: string): {
  hasLoader: boolean; hasSubscribe: boolean; hasSocket: boolean; hasAuth: boolean;
  hasMeta: boolean; hasStandalone: boolean; prerender: boolean;
} {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const classStart = content.search(/export\s+class\s+\w+/);

    const hasExportBefore = (regex: RegExp) => {
      const match = regex.exec(content);
      if (!match) return false;
      if (classStart >= 0 && match.index > classStart) return false;
      return true;
    };

    const isIndex = path.basename(filePath).replace(/\.(ts|js)$/, '') === 'index';
    const dir = path.dirname(filePath);

    const hasColocatedLoader = isIndex &&
      (fs.existsSync(path.join(dir, '_loader.ts')) || fs.existsSync(path.join(dir, '_loader.js')));
    const hasColocatedSocket = isIndex &&
      (fs.existsSync(path.join(dir, '_socket.ts')) || fs.existsSync(path.join(dir, '_socket.js')));
    const hasColocatedSubscribe = isIndex &&
      (fs.existsSync(path.join(dir, '_subscribe.ts')) || fs.existsSync(path.join(dir, '_subscribe.js')));

    return {
      hasLoader: hasExportBefore(/export\s+(async\s+)?function\s+loader\s*\(/) || hasColocatedLoader,
      hasSubscribe: hasExportBefore(/export\s+(async\s+)?function\s+subscribe\s*\(/) || hasColocatedSubscribe,
      hasSocket: /export\s+(function|const)\s+socket[\s(=]/.test(content) || hasColocatedSocket,
      hasAuth: hasExportBefore(/export\s+const\s+auth\s*=/),
      hasMeta: hasExportBefore(/export\s+(const\s+meta\s*=|(async\s+)?function\s+meta\s*\()/),
      hasStandalone: hasExportBefore(/export\s+const\s+standalone\s*=/),
      prerender: /export\s+const\s+prerender\s*=\s*true/.test(content),
    };
  } catch {
    return { hasLoader: false, hasSubscribe: false, hasSocket: false, hasAuth: false, hasMeta: false, hasStandalone: false, prerender: false };
  }
}

export interface PageEntry {
  name: string;
  filePath: string;
  routePath: string;
  hasLoader: boolean;
  hasSubscribe: boolean;
  hasSocket: boolean;
  hasAuth: boolean;
  hasMeta: boolean;
  hasStandalone: boolean;
  prerender: boolean;
}

export interface LayoutEntry {
  dir: string;
  filePath: string;
  hasLoader: boolean;
  hasSubscribe: boolean;
}

export interface ApiEntry {
  name: string;
  filePath: string;
  routePath: string;
}

export function scanPages(pagesDir: string): PageEntry[] {
  if (!fs.existsSync(pagesDir)) return [];
  const entries: PageEntry[] = [];
  walkDir(pagesDir, '', entries, pagesDir);
  return entries;
}

export function scanLayouts(pagesDir: string): LayoutEntry[] {
  if (!fs.existsSync(pagesDir)) return [];
  const entries: LayoutEntry[] = [];
  walkForLayouts(pagesDir, '', entries);
  return entries;
}

export function scanApiRoutes(apiDir: string): ApiEntry[] {
  if (!fs.existsSync(apiDir)) return [];
  const entries: ApiEntry[] = [];
  walkApiDir(apiDir, '', entries, apiDir);
  return entries;
}

/** Get the layout directory chain for a given page file */
export function getLayoutDirsForPage(pageFilePath: string, pagesDir: string, layouts: LayoutEntry[]): string[] {
  const relativeToPages = path.relative(pagesDir, pageFilePath).replace(/\\/g, '/');
  const dirParts = path.dirname(relativeToPages).split('/').filter(p => p && p !== '.');

  const chain: string[] = [];

  // Check root layout
  if (layouts.some(l => l.dir === '')) {
    chain.push('');
  }

  // Check each directory level
  let currentDir = '';
  for (const part of dirParts) {
    currentDir = currentDir ? `${currentDir}/${part}` : part;
    if (layouts.some(l => l.dir === currentDir)) {
      chain.push(currentDir);
    }
  }

  return chain;
}

function walkDir(baseDir: string, relativePath: string, entries: PageEntry[], pagesDir: string) {
  const fullDir = path.join(baseDir, relativePath);
  const dirEntries = fs.readdirSync(fullDir, { withFileTypes: true });

  // Check if this subdirectory contains an index file (folder route)
  // Only applies to subdirectories, not the root pages directory
  const hasIndex = relativePath !== '' && dirEntries.some(
    e => e.isFile() && /^index\.(ts|js)$/.test(e.name)
  );

  for (const entry of dirEntries) {
    const entryRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      walkDir(baseDir, entryRelative, entries, pagesDir);
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
      // In a folder route (has index file), only register the index file and dynamic param files
      if (hasIndex && !/^index\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('[')) continue;
      const filePath = path.join(pagesDir, entryRelative);
      const name = entryRelative.replace(/\.(ts|js)$/, '').replace(/\\/g, '/');
      const routePath = filePathToRoute(entryRelative);
      const flags = analyzePageFile(filePath);
      entries.push({ name, filePath, routePath, ...flags });
    }
  }
}

function walkForLayouts(baseDir: string, relativePath: string, entries: LayoutEntry[]) {
  const fullDir = path.join(baseDir, relativePath);
  const dirEntries = fs.readdirSync(fullDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    if (entry.isFile() && /^_layout\.(ts|js)$/.test(entry.name)) {
      const filePath = path.join(fullDir, entry.name);
      const dir = relativePath.replace(/\\/g, '/');
      entries.push({ dir, filePath, hasLoader: fileHasLoader(filePath), hasSubscribe: fileHasSubscribe(filePath) });
    }
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      walkForLayouts(baseDir, path.join(relativePath, entry.name), entries);
    }
  }
}

export interface MiddlewareEntry {
  dir: string;
  filePath: string;
}

/**
 * Scan for _middleware.ts files in the pages directory tree.
 */
export function scanMiddleware(pagesDir: string): MiddlewareEntry[] {
  if (!fs.existsSync(pagesDir)) return [];
  const entries: MiddlewareEntry[] = [];
  walkForMiddleware(pagesDir, '', entries);
  return entries;
}

/**
 * Get middleware directories that match a given URL pathname.
 * Returns matching middleware entries from root → deepest.
 */
export function getMiddlewareDirsForPathname(pathname: string, entries: MiddlewareEntry[]): MiddlewareEntry[] {
  const urlSegments = pathname.replace(/^\//, '').split('/').filter(Boolean);
  return entries.filter(entry => {
    if (entry.dir === '') return true; // Root middleware applies to all routes
    const dirSegments = entry.dir.split('/').filter(Boolean);
    if (dirSegments.length > urlSegments.length) return false;
    return dirSegments.every((seg, i) => seg === urlSegments[i]);
  }).sort((a, b) => a.dir.split('/').length - b.dir.split('/').length);
}

function walkForMiddleware(baseDir: string, relativePath: string, entries: MiddlewareEntry[]) {
  const fullDir = path.join(baseDir, relativePath);
  const dirEntries = fs.readdirSync(fullDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    if (entry.isFile() && /^_middleware\.(ts|js)$/.test(entry.name)) {
      const filePath = path.join(fullDir, entry.name);
      const dir = relativePath.replace(/\\/g, '/');
      entries.push({ dir, filePath });
    }
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      walkForMiddleware(baseDir, path.join(relativePath, entry.name), entries);
    }
  }
}

function walkApiDir(baseDir: string, relativePath: string, entries: ApiEntry[], apiDir: string) {
  const fullDir = path.join(baseDir, relativePath);
  const dirEntries = fs.readdirSync(fullDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    const entryRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      walkApiDir(baseDir, entryRelative, entries, apiDir);
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
      const filePath = path.join(apiDir, entryRelative);
      const name = entryRelative.replace(/\.(ts|js)$/, '').replace(/\\/g, '/');
      const routePath = entryRelative
        .replace(/\.(ts|js)$/, '')
        .replace(/\\/g, '/')
        .replace(/\[([^\]]+)\]/g, ':$1');
      entries.push({ name, filePath, routePath });
    }
  }
}
