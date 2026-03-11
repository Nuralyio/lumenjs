import { Plugin } from 'vite';
import path from 'path';

/**
 * Auto-define plugin — appends customElements.define() for page/layout components
 * that extend LitElement but don't use the @customElement decorator.
 *
 * Tag naming:
 *   pages/index.ts          → page-index
 *   pages/blog/post.ts      → page-blog-post
 *   pages/_layout.ts        → layout-root
 *   pages/dashboard/_layout.ts → layout-dashboard
 */
export function autoDefinePlugin(pagesDir: string): Plugin {
  return {
    name: 'lumenjs-auto-define',
    transform(code: string, id: string) {
      if (!id.startsWith(pagesDir) || !id.endsWith('.ts')) return;
      if (code.includes('@customElement')) return;

      const classMatch = code.match(/export\s+class\s+(\w+)\s+extends\s+LitElement/);
      if (!classMatch) return;

      const className = classMatch[1];
      const relative = path.relative(pagesDir, id).replace(/\.ts$/, '');
      const segments = relative.split(path.sep);
      const fileName = segments[segments.length - 1];

      // Skip _ prefixed files that aren't _layout
      if (fileName.startsWith('_') && fileName !== '_layout') return;

      let tag: string;
      if (fileName === '_layout') {
        // Layout: layout-<parent> or layout-root for top-level
        const parent = segments.length > 1 ? segments[segments.length - 2] : 'root';
        tag = `layout-${parent}`;
      } else {
        // Page: page-<path segments joined with ->
        tag = 'page-' + segments.join('-');
      }

      if (code.includes(`customElements.define('${tag}'`)) return;

      return {
        code: code + `\ncustomElements.define('${tag}', ${className});`,
        map: null,
      };
    },
  };
}
