import { Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

/**
 * Force ALL lit imports to resolve to lumenjs's single lit copy.
 */
export function litDedupPlugin(lumenNodeModules: string, isDev: boolean): Plugin {
  return {
    name: 'lumenjs-lit-dedup',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined, options?: { ssr?: boolean }) {
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
      if (!fs.existsSync(pkgDir)) return;

      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
        const exports = pkg.exports;
        if (exports) {
          const exportKey = subpath ? './' + subpath : '.';
          const entry = exports[exportKey];
          if (entry) {
            let resolved: string | undefined;
            if (options?.ssr) {
              resolved = isDev
                ? (entry?.node?.development || entry?.node?.default || entry?.node || entry?.development || entry?.default || entry)
                : (entry?.node?.default || entry?.node || entry?.default || entry);
            } else {
              resolved = isDev
                ? (entry?.browser?.development || entry?.development || entry?.browser?.default || entry?.default || entry)
                : (entry?.browser?.default || entry?.browser || entry?.default || entry);
            }
            if (typeof resolved === 'string') {
              return path.join(pkgDir, resolved);
            }
          }
        }
        if (subpath) {
          return path.join(pkgDir, subpath);
        }
        const entry = pkg.module || pkg.main || 'index.js';
        return path.join(pkgDir, entry);
      } catch {
        return subpath ? path.join(pkgDir, subpath) : pkgDir;
      }
    }
  };
}
