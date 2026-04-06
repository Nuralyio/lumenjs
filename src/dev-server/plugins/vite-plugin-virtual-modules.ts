import fs from 'fs';
import path from 'path';
import { Plugin } from 'vite';

/**
 * Virtual module plugin — serves compiled LumenJS runtime and editor modules.
 * Rewrites relative imports between split sub-modules to virtual module paths.
 *
 * i18n is resolved via resolve.alias (physical file) rather than as a virtual
 * module, because Vite's import-analysis rejects bare @-prefixed specifiers
 * that go through the virtual module path.
 */
export function virtualModulesPlugin(runtimeDir: string, editorDir: string): Plugin {
  const runtimeModules: Record<string, string> = {
    'app-shell': 'app-shell.js',
    'router': 'router.js',
    'router-data': 'router-data.js',
    'router-hydration': 'router-hydration.js',
    'i18n': 'i18n.js',
    'auth': 'auth.js',
    'communication': 'communication.js',
    'webrtc': 'webrtc.js',
    'error-boundary': 'error-boundary.js',
    'island': 'island.js',
    'hydrate-support': '__virtual__',
  };

  // Modules resolved via resolve.alias instead of virtual module.
  // They still appear in the map so relative import rewrites work.
  const aliasedModules = new Set(['i18n', 'auth', 'communication', 'webrtc']);

  const editorModules: Record<string, string> = {
    'editor-bridge': 'editor-bridge.js',
    'element-annotator': 'element-annotator.js',
    'click-select': 'click-select.js',
    'hover-detect': 'hover-detect.js',
    'inline-text-edit': 'inline-text-edit.js',
    'editor-api-client': 'editor-api-client.js',
    'standalone-overlay': 'standalone-overlay.js',
    'standalone-overlay-dom': 'standalone-overlay-dom.js',
    'standalone-overlay-styles': 'standalone-overlay-styles.js',
    'standalone-file-panel': 'standalone-file-panel.js',
    'overlay-utils': 'overlay-utils.js',
    'overlay-events': 'overlay-events.js',
    'overlay-hmr': 'overlay-hmr.js',
    'overlay-selection': 'overlay-selection.js',
    'text-toolbar': 'text-toolbar.js',
    'toolbar-styles': 'toolbar-styles.js',
    'editor-toolbar': 'editor-toolbar.js',
    'css-rules': 'css-rules.js',
    'ast-modification': 'ast-modification.js',
    'ast-service': 'ast-service.js',
    'file-service': 'file-service.js',
    'file-editor': 'file-editor.js',
    'syntax-highlighter': 'syntax-highlighter.js',
    'property-registry': 'property-registry.js',
    'properties-panel': 'properties-panel.js',
    'properties-panel-persist': 'properties-panel-persist.js',
    'properties-panel-rows': 'properties-panel-rows.js',
    'properties-panel-styles': 'properties-panel-styles.js',
    'i18n-key-gen': 'i18n-key-gen.js',
    'ai-chat-panel': 'ai-chat-panel.js',
    'ai-project-panel': 'ai-project-panel.js',
    'ai-markdown': 'ai-markdown.js',
  };

  function rewriteRelativeImports(code: string, modules: Record<string, string>): string {
    for (const name of Object.keys(modules)) {
      const file = modules[name];
      // Aliased modules use @lumenjs/name (resolved by Vite alias).
      // Virtual modules use /@lumenjs/name (resolved by this plugin).
      const prefix = aliasedModules.has(name) ? '@lumenjs' : '/@lumenjs';
      const escaped = file.replace('.', '\\.');
      // Rewrite `from './file.js'`
      code = code.replace(
        new RegExp(`from\\s+['"]\\.\\/${escaped}['"]`, 'g'),
        `from '${prefix}/${name}'`
      );
      // Rewrite side-effect `import './file.js'`
      code = code.replace(
        new RegExp(`import\\s+['"]\\.\\/${escaped}['"]`, 'g'),
        `import '${prefix}/${name}'`
      );
    }
    return code;
  }

  let viteBase = '/';

  return {
    name: 'lumenjs-virtual-modules',
    enforce: 'pre' as const,
    configResolved(config) {
      viteBase = config.base || '/';
    },
    resolveId(id) {
      // Strip Vite base prefix if present (e.g. /__app_dev/{id}/@lumenjs/foo → /@lumenjs/foo)
      if (viteBase !== '/' && id.startsWith(viteBase)) {
        id = '/' + id.slice(viteBase.length);
      }
      const match = id.match(/^\/@lumenjs\/(.+)$/);
      if (!match) return;
      const name = match[1];
      // Skip aliased modules — they're resolved via resolve.alias
      if (aliasedModules.has(name)) return;
      if (runtimeModules[name] || editorModules[name]) {
        return `\0lumenjs:${name}`;
      }
    },
    load(id) {
      if (!id.startsWith('\0lumenjs:')) return;
      const name = id.slice('\0lumenjs:'.length);

      if (name === 'hydrate-support') {
        // Custom hydrate support that catches digest mismatch errors and falls
        // back to CSR instead of leaving double-rendered content.
        // The stock @lit-labs/ssr-client/lit-element-hydrate-support.js throws
        // on digest mismatch, sets _$AG=false before throwing, so the next
        // update() appends fresh render alongside stale SSR content.
        return `
import { render } from 'lit-html';
import { hydrate } from '@lit-labs/ssr-client';

globalThis.litElementHydrateSupport = ({LitElement}) => {
  const observedGet = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(LitElement), 'observedAttributes'
  ).get;
  Object.defineProperty(LitElement, 'observedAttributes', {
    get() { return [...observedGet.call(this), 'defer-hydration']; }
  });

  const origAttrChanged = LitElement.prototype.attributeChangedCallback;
  LitElement.prototype.attributeChangedCallback = function(name, old, value) {
    if (name === 'defer-hydration' && value === null) {
      origConnected.call(this);
    }
    origAttrChanged.call(this, name, old, value);
  };

  const origConnected = LitElement.prototype.connectedCallback;
  LitElement.prototype.connectedCallback = function() {
    if (!this.hasAttribute('defer-hydration')) origConnected.call(this);
  };

  function adoptElementStyles(el) {
    const styles = el.constructor.elementStyles;
    if (styles?.length && el.renderRoot instanceof ShadowRoot) {
      el.renderRoot.adoptedStyleSheets = styles.map(
        s => s instanceof CSSStyleSheet ? s : s.styleSheet
      );
    }
  }

  const origCreateRoot = LitElement.prototype.createRenderRoot;
  LitElement.prototype.createRenderRoot = function() {
    if (this.shadowRoot) {
      this._$AG = true;
      // Adopt styles that SSR declarative shadow roots don't include
      adoptElementStyles(this);
      return this.shadowRoot;
    }
    return origCreateRoot.call(this);
  };

  const superUpdate = Object.getPrototypeOf(LitElement.prototype).update;
  LitElement.prototype.update = function(changedProps) {
    const value = this.render();
    superUpdate.call(this, changedProps);
    if (this._$AG) {
      this._$AG = false;
      for (const attr of this.getAttributeNames()) {
        if (attr.startsWith('hydrate-internals-')) {
          this.removeAttribute(attr.slice(18));
          this.removeAttribute(attr);
        }
      }
      try {
        hydrate(value, this.renderRoot, this.renderOptions);
      } catch (err) {
        // Digest mismatch — re-render fresh but avoid visible flash
        console.warn('[LumenJS] Hydration mismatch for <' + this.localName + '>, falling back to CSR');
        const root = this.renderRoot;
        // Preserve adopted styles so content is never unstyled
        adoptElementStyles(this);
        // Remove only non-style children to keep styles applied during re-render
        const toRemove = [];
        for (let c = root.firstChild; c; c = c.nextSibling) {
          if (c.nodeName !== 'STYLE') toRemove.push(c);
        }
        toRemove.forEach(c => root.removeChild(c));
        delete root._$litPart$;
        render(value, root, this.renderOptions);
      }
    } else {
      render(value, this.renderRoot, this.renderOptions);
    }
  };
};
`;
      }
      if (runtimeModules[name]) {
        let code = fs.readFileSync(path.join(runtimeDir, runtimeModules[name]), 'utf-8');
        // Prepend hydrate support to app-shell so all Lit imports share one module graph.
        // Uses our custom hydrate-support virtual module (with CSR fallback) instead of stock.
        if (name === 'app-shell') {
          code = `import '/@lumenjs/hydrate-support';\n` + code;
        }
        return rewriteRelativeImports(code, runtimeModules);
      }
      if (editorModules[name]) {
        const code = fs.readFileSync(path.join(editorDir, editorModules[name]), 'utf-8');
        return rewriteRelativeImports(code, editorModules);
      }
    }
  };
}
