import fs from 'fs';
import path from 'path';
import { fileHasLoader, fileHasSubscribe, filePathToRoute } from '../shared/utils.js';

export interface PageEntry {
  name: string;
  filePath: string;
  routePath: string;
  hasLoader: boolean;
  hasSubscribe: boolean;
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

  for (const entry of dirEntries) {
    const entryRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      walkDir(baseDir, entryRelative, entries, pagesDir);
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
      const filePath = path.join(pagesDir, entryRelative);
      const name = entryRelative.replace(/\.(ts|js)$/, '').replace(/\\/g, '/');
      const routePath = filePathToRoute(entryRelative);
      const hasLoader = fileHasLoader(filePath);
      const hasSubscribe = fileHasSubscribe(filePath);
      entries.push({ name, filePath, routePath, hasLoader, hasSubscribe });
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
    if (entry.isDirectory()) {
      walkForLayouts(baseDir, path.join(relativePath, entry.name), entries);
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
