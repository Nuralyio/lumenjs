import { Plugin } from 'vite';
import path from 'path';
import { filePathToTagName, dirToLayoutTagName } from '../../shared/utils.js';

/**
 * Auto-registers custom elements for page and layout files.
 *
 * Scans for the exported class that extends LitElement and appends a
 * `customElements.define('tag-name', ClassName)` call. The tag name is
 * derived from the file path using the same convention the router uses:
 *
 *   pages/index.ts          → page-index
 *   pages/docs/routing.ts   → page-docs-routing
 *   pages/_layout.ts        → layout-root
 *   pages/docs/_layout.ts   → layout-docs
 *
 * This removes the need for `@customElement('...')` in page/layout files.
 */
export function autoDefinePlugin(pagesDir: string): Plugin {
  return {
    name: 'lumenjs-auto-define',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.startsWith(pagesDir) || !id.endsWith('.ts')) return;

      const relative = path.relative(pagesDir, id).replace(/\\/g, '/');
      const basename = path.basename(relative, '.ts');

      // Determine if this is a layout or a page
      const isLayout = basename === '_layout';
      if (!isLayout && basename.startsWith('_')) return; // skip other _ files

      // Derive the tag name
      const tagName = isLayout
        ? dirToLayoutTagName(path.dirname(relative) === '.' ? '' : path.dirname(relative))
        : filePathToTagName(relative);

      // Find the exported class that extends LitElement
      const classMatch = code.match(/export\s+class\s+(\w+)\s+extends\s+LitElement\b/);
      if (!classMatch) return;

      const className = classMatch[1];

      // Skip if already has a customElements.define or @customElement for this class
      if (code.includes(`customElements.define('${tagName}'`)) return;
      // Check for actual decorator usage (not mentions in HTML/text content)
      if (/^\s*@customElement\s*\(/m.test(code)) return;

      // Append the define call
      const defineCall = `\ncustomElements.define('${tagName}', ${className});\n`;
      return { code: code + defineCall, map: null };
    },
  };
}
