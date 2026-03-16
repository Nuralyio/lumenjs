import { Plugin } from 'vite';

/**
 * Lit HMR plugin — patches existing custom element prototypes instead of re-registering.
 */
export function litHmrPlugin(projectDir: string): Plugin {
  return {
    name: 'lumenjs-lit-hmr',
    enforce: 'post' as const,
    transform(code: string, id: string) {
      if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
      const match = code.match(/(\w+)\s*=\s*__decorateClass\(\s*\[\s*\n?\s*customElement\(\s*"([^"]+)"\s*\)\s*\n?\s*\]\s*,\s*\1\s*\)/);
      if (!match) return;
      const [fullMatch, className, tagName] = match;

      const transformed = code.replace(fullMatch,
        `if (!customElements.get("${tagName}")) {\n  customElements.define("${tagName}", ${className});\n}`
      ) + `
// --- Lit HMR ---
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (!newModule) return;
    const NewClass = newModule.${className};
    if (!NewClass) return;
    const OldClass = customElements.get("${tagName}");
    if (!OldClass) return;
    const descriptors = Object.getOwnPropertyDescriptors(NewClass.prototype);
    for (const [key, desc] of Object.entries(descriptors)) {
      if (key === "constructor") continue;
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
    __queryShadowAll(document, "${tagName}").forEach((el) => {
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
      return { code: transformed, map: null };
    }
  };
}
