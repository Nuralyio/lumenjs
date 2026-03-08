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
    if (NewClass.styles) {
      OldClass.styles = NewClass.styles;
      OldClass.elementStyles = undefined;
      OldClass.finalizeStyles();
    }
    if (NewClass.properties) {
      OldClass.properties = NewClass.properties;
    }
    document.querySelectorAll("${tagName}").forEach((el) => {
      if (el.requestUpdate) el.requestUpdate();
    });
  });
}
`;
      return { code: transformed, map: null };
    }
  };
}
