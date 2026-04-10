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
 * Auto-wire a component class to fetch its server loader data on mount.
 * Called by the Vite transform — NOT by user code.
 *
 * Patches the class prototype's connectedCallback to:
 * 1. Call the original connectedCallback
 * 2. Fetch loader data from the server (CSR only — SSR sets loaderData before hydration)
 * 3. Spread each key as an individual property
 * 4. Call requestUpdate() to re-render
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
    // Skip fetch if data was already set via SSR hydration or a previous mount
    if (this.__nk_loader_fetched || this.loaderData !== undefined) {
      return;
    }
    this.__nk_loader_fetched = true;
    fetchComponentLoaderData(componentFile).then(data => {
      if (data) {
        spreadData(this, data);
        if (typeof this.requestUpdate === 'function') {
          this.requestUpdate();
        }
      }
    });
  };
}
