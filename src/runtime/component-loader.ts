import { fetchComponentLoaderData } from './router-data.js';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype',
  'innerHTML', 'outerHTML', 'textContent',
  'render', 'connectedCallback', 'disconnectedCallback']);

function spreadData(el: Element, data: any): void {
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (!BLOCKED_KEYS.has(key)) {
        (el as any)[key] = value;
      }
    }
  }
}

/**
 * Fetch loader data and spread it on a single element instance.
 */
function fetchAndSpread(el: any, componentFile: string): void {
  if (el.__nk_loader_fetched || el.loaderData !== undefined) return;
  el.__nk_loader_fetched = true;
  fetchComponentLoaderData(componentFile).then(data => {
    if (data) {
      spreadData(el, data);
      if (typeof el.requestUpdate === 'function') {
        el.requestUpdate();
      }
    }
  });
}

/**
 * Auto-wire a component class to fetch its server loader data on mount.
 * Called by the Vite transform — NOT by user code.
 *
 * Patches the class prototype's connectedCallback to:
 * 1. Call the original connectedCallback
 * 2. Fetch loader data from the server (CSR only — SSR sets loaderData before hydration)
 * 3. Spread each key as an individual property
 * 4. Call requestUpdate() to re-render
 *
 * Also handles elements that were already upgraded (e.g. when customElements.define
 * runs before this function — the upgrade triggers the original connectedCallback,
 * so the patched version never fires for those instances).
 */
export function __nk_setupComponentLoader(
  Ctor: new (...args: any[]) => HTMLElement,
  componentFile: string
): void {
  const proto = Ctor.prototype;
  const original = proto.connectedCallback;

  proto.connectedCallback = function (this: any) {
    if (typeof original === 'function') {
      original.call(this);
    }
    fetchAndSpread(this, componentFile);
  };

  // Handle elements already upgraded before this patch was applied.
  // customElements.define() may have run first, upgrading existing DOM elements
  // with the original (unpatched) connectedCallback.
  if (typeof document !== 'undefined') {
    queueMicrotask(() => {
      const walk = (root: ParentNode) => {
        root.querySelectorAll('*').forEach(el => {
          if (el instanceof Ctor) fetchAndSpread(el as any, componentFile);
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      };
      walk(document);
    });
  }
}
