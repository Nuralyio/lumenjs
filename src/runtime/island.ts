/**
 * <nk-island> — Islands Architecture hydration wrapper.
 *
 * Strategies:
 *   client:load    — import module immediately on page load
 *   client:visible — import module when the element scrolls into view
 *   client:idle    — import module when the browser is idle (requestIdleCallback)
 *   client:media   — import module when a media query matches (value = query string)
 *
 * The `import` attribute specifies the module path to load.
 */
class NkIsland extends HTMLElement {
  private _loaded = false;

  connectedCallback() {
    const importPath = this.getAttribute('import');
    if (!importPath || this._loaded) return;

    if (this.hasAttribute('client:load')) {
      this._hydrate(importPath);
    } else if (this.hasAttribute('client:visible')) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            observer.disconnect();
            this._hydrate(importPath);
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(this);
    } else if (this.hasAttribute('client:idle')) {
      const cb = () => this._hydrate(importPath);
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(cb);
      } else {
        setTimeout(cb, 200);
      }
    } else if (this.hasAttribute('client:media')) {
      const query = this.getAttribute('client:media') || '';
      const mql = window.matchMedia(query);
      const handler = () => {
        if (mql.matches) {
          mql.removeEventListener('change', handler);
          this._hydrate(importPath);
        }
      };
      if (mql.matches) {
        this._hydrate(importPath);
      } else {
        mql.addEventListener('change', handler);
      }
    }
  }

  private _hydrate(importPath: string) {
    if (this._loaded) return;
    this._loaded = true;
    // Check global island registry (populated by pages with island imports)
    const registry = (window as any).__nk_islands;
    const loader = registry?.[importPath];
    const promise = loader
      ? loader()
      : import(/* @vite-ignore */ importPath);
    promise.then(() => {
      this.setAttribute('data-hydrated', '');
      this.dispatchEvent(new Event('island-hydrated', { bubbles: true, composed: true }));
    }).catch((err: any) => {
      console.error(`[nk-island] Failed to load module: ${importPath}`, err);
    });
  }
}

if (!customElements.get('nk-island')) {
  customElements.define('nk-island', NkIsland);
}
