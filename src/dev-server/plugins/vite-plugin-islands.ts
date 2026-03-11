import path from 'path';
import { Plugin } from 'vite';

/**
 * Vite plugin for islands architecture support.
 * Resolves relative `import` attribute paths in <nk-island> elements
 * within tagged template literals to absolute Vite-servable paths.
 */
export function islandsPlugin(projectDir: string): Plugin {
  const islandImportRe = /<nk-island\s[^>]*import=["'](\.[^"']+)["']/g;

  return {
    name: 'lumenjs-islands',
    enforce: 'pre' as const,

    transform(code, id) {
      // Only process project source files (not node_modules or virtual modules)
      if (!id.startsWith(projectDir) || id.includes('node_modules')) return;
      if (!code.includes('nk-island')) return;

      let hasReplacements = false;
      const result = code.replace(islandImportRe, (fullMatch, relativePath) => {
        const dir = path.dirname(id);
        const absolutePath = path.resolve(dir, relativePath);
        // Convert to a path relative to project root for Vite to resolve
        const viteServable = '/' + path.relative(projectDir, absolutePath).replace(/\\/g, '/');
        hasReplacements = true;
        return fullMatch.replace(relativePath, viteServable);
      });

      if (!hasReplacements) return;
      return { code: result, map: null };
    },
  };
}
