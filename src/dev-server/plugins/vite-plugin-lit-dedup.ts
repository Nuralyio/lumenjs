import { Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

/**
 * Force ALL lit imports to resolve to lumenjs's single lit copy.
 *
 * Instead of returning absolute paths directly (which bypasses Vite's ?v= cache
 * busting and causes module duplication), we resolve the correct entry point
 * from package.json exports, then delegate to Vite's resolver using a fake
 * importer within lumenjs node_modules. This ensures consistent ?v= hashing
 * across all import chains.
 */
export function litDedupPlugin(lumenNodeModules: string, isDev: boolean): Plugin {
  // Cache resolved export paths per (pkgName, subpath) to avoid repeated pkg.json reads
  const exportCache = new Map<string, string | null>();

  function resolveExport(pkgName: string, subpath: string, ssr: boolean): string | null {
    const cacheKey = `${pkgName}:${subpath}:${ssr}`;
    if (exportCache.has(cacheKey)) return exportCache.get(cacheKey)!;

    const pkgDir = path.join(lumenNodeModules, pkgName);
    if (!fs.existsSync(pkgDir)) {
      exportCache.set(cacheKey, null);
      return null;
    }

    let resolved: string | null = null;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
      const exports = pkg.exports;
      if (exports) {
        const exportKey = subpath ? './' + subpath : '.';
        const entry = exports[exportKey];
        if (entry) {
          let entryPath: string | undefined;
          if (ssr) {
            entryPath = isDev
              ? (entry?.node?.development || entry?.node?.default || entry?.node || entry?.development || entry?.default || entry)
              : (entry?.node?.default || entry?.node || entry?.default || entry);
          } else {
            entryPath = isDev
              ? (entry?.browser?.development || entry?.development || entry?.browser?.default || entry?.default || entry)
              : (entry?.browser?.default || entry?.browser || entry?.default || entry);
          }
          if (typeof entryPath === 'string') {
            let finalPath = entryPath;
            // In dev mode, prefer development/ builds to avoid mixing prod/dev modules
            if (isDev && !entryPath.includes('/development/')) {
              const devEntryPath = entryPath.replace(/^\.\//, '');
              const devFullPath = path.join(pkgDir, 'development', devEntryPath);
              if (fs.existsSync(devFullPath)) {
                finalPath = './development/' + devEntryPath;
              }
            }
            resolved = finalPath;
          }
        }
      }
      if (!resolved && subpath) {
        resolved = './' + subpath;
      }
      if (!resolved) {
        const entry = pkg.module || pkg.main || 'index.js';
        resolved = './' + entry;
      }
    } catch {
      resolved = subpath ? './' + subpath : null;
    }

    exportCache.set(cacheKey, resolved);
    return resolved;
  }

  return {
    name: 'lumenjs-lit-dedup',
    enforce: 'pre' as const,
    async resolveId(source: string, importer: string | undefined, options?: { ssr?: boolean }) {
      if (!importer) return;
      const isLitImport = source === 'lit' || source.startsWith('lit/')
        || source === 'lit-html' || source.startsWith('lit-html/')
        || source === 'lit-element' || source.startsWith('lit-element/')
        || source === '@lit/reactive-element' || source.startsWith('@lit/reactive-element/')
        || source === '@lit-labs/ssr' || source.startsWith('@lit-labs/ssr/')
        || source === '@lit-labs/ssr-client' || source.startsWith('@lit-labs/ssr-client/')
        || source === '@lit-labs/ssr-dom-shim' || source.startsWith('@lit-labs/ssr-dom-shim/');
      if (!isLitImport) return;

      const parts = source.split('/');
      const pkgName = source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const subpath = source.startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/');
      const pkgDir = path.join(lumenNodeModules, pkgName);

      const resolved = resolveExport(pkgName, subpath, !!options?.ssr);
      if (!resolved) return;

      // Compute the absolute path for the resolved entry
      const absolutePath = path.join(pkgDir, resolved);

      // Delegate to Vite's resolver using a fake importer inside lumenjs node_modules.
      // This ensures Vite's importAnalysis adds consistent ?v= cache busting,
      // preventing module duplication between different import chains.
      const fakeImporter = path.join(lumenNodeModules, '_lumenjs_dedup_anchor.js');
      const result = await this.resolve(absolutePath, fakeImporter, { skipSelf: true });
      if (result) return result;

      // Fallback to absolute path if Vite's resolver fails
      return absolutePath;
    }
  };
}
