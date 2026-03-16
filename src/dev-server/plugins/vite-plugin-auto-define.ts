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

      // Append the define call + HMR support
      const defineCall = `
if (!customElements.get('${tagName}')) {
  customElements.define('${tagName}', ${className});
}
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (!newModule) return;
    const NewClass = newModule.${className};
    if (!NewClass) return;
    const OldClass = customElements.get('${tagName}');
    if (!OldClass) return;
    const descriptors = Object.getOwnPropertyDescriptors(NewClass.prototype);
    for (const [key, desc] of Object.entries(descriptors)) {
      if (key === 'constructor') continue;
      Object.defineProperty(OldClass.prototype, key, desc);
    }
    const newCssText = NewClass.styles?.cssText || '';
    if (NewClass.styles) {
      OldClass.styles = NewClass.styles;
      OldClass.elementStyles = undefined;
      OldClass.finalized = false;
      try { OldClass.finalizeStyles(); } catch {}
    }
    if (NewClass.properties) {
      OldClass.properties = NewClass.properties;
    }
    function __queryShadowAll(root, sel) {
      const results = [...root.querySelectorAll(sel)];
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) results.push(...__queryShadowAll(el.shadowRoot, sel));
      }
      return results;
    }
    __queryShadowAll(document, '${tagName}').forEach((el) => {
      if (el.renderRoot) {
        // Update styles: try adoptedStyleSheets first, fall back to <style> tag
        if (OldClass.elementStyles && OldClass.elementStyles.length > 0) {
          const sheets = OldClass.elementStyles
            .filter(s => s instanceof CSSStyleSheet || (s && s.styleSheet))
            .map(s => s instanceof CSSStyleSheet ? s : s.styleSheet);
          if (sheets.length && el.renderRoot.adoptedStyleSheets !== undefined) {
            el.renderRoot.adoptedStyleSheets = sheets;
          }
        } else if (newCssText) {
          const styleEl = el.renderRoot.querySelector('style');
          if (styleEl) styleEl.textContent = newCssText;
        }
        // Clear stale SSR inline styles from child elements
        el.renderRoot.querySelectorAll('[style]').forEach((child) => {
          child.removeAttribute('style');
        });
        // Clear Lit's template cache to force re-render with new template
        const childPart = Object.getOwnPropertySymbols(el.renderRoot)
          .map(s => el.renderRoot[s])
          .find(v => v && typeof v === 'object' && '_$committedValue' in v);
        if (childPart) childPart._$committedValue = undefined;
      }
      if (el.requestUpdate) el.requestUpdate();
    });
  });
}
`;
      return { code: code + defineCall, map: null };
    },
  };
}
