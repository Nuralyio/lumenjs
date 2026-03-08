/**
 * Install DOM shims needed for SSR rendering of Lit/NuralyUI components.
 * Consolidates the various partial shim implementations across the codebase.
 */
export function installDomShims() {
  const g = globalThis as any;
  const noop = () => null;

  if (!g.HTMLElement) {
    g.HTMLElement = class HTMLElement {};
  }
  if (!g.customElements) {
    const registry = new Map<string, any>();
    g.customElements = {
      get: (name: string) => registry.get(name),
      define: (name: string, ctor: any) => registry.set(name, ctor),
    };
  }
  if (!g.document) {
    g.document = {
      createTreeWalker: () => ({ nextNode: () => null }),
      body: {},
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: noop,
      documentElement: { getAttribute: noop, setAttribute: noop, removeAttribute: noop, closest: noop },
      createComment: (text: string) => ({ textContent: text }),
      createTextNode: (text: string) => ({ textContent: text }),
    };
  }
  // Patch missing document properties (SSR DOM shim may not include all of them)
  if (g.document && !g.document.documentElement) {
    g.document.documentElement = { getAttribute: noop, setAttribute: noop, removeAttribute: noop, closest: noop };
  }
  if (g.document?.documentElement && !g.document.documentElement.getAttribute) {
    g.document.documentElement.getAttribute = noop;
  }
  if (!g.window) {
    g.window = g;
  }
  if (!g.window.matchMedia) {
    g.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  }
  if (!g.CSSStyleSheet) {
    g.CSSStyleSheet = class CSSStyleSheet {};
  }
  if (!g.MutationObserver) {
    g.MutationObserver = class MutationObserver { observe() {} disconnect() {} };
  }
  if (g.HTMLElement && !g.HTMLElement.prototype.closest) {
    g.HTMLElement.prototype.closest = noop;
  }
  if (g.HTMLElement && !g.HTMLElement.prototype.querySelector) {
    g.HTMLElement.prototype.querySelector = noop;
  }
  if (g.HTMLElement && !g.HTMLElement.prototype.querySelectorAll) {
    g.HTMLElement.prototype.querySelectorAll = () => [];
  }
}
