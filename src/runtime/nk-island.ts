/**
 * <nk-island> — Islands architecture wrapper element.
 * Defers loading of interactive component modules until a hydration strategy triggers.
 *
 * Strategies:
 *   client:load    — immediate
 *   client:visible — IntersectionObserver
 *   client:idle    — requestIdleCallback
 *   client:media   — matchMedia query
 *
 * Plain HTMLElement (not LitElement) so it doesn't participate in Lit hydration.
 */
class NkIsland extends HTMLElement {
  private _observer: IntersectionObserver | null = null;
  private _mediaQuery: MediaQueryList | null = null;
  private _mediaHandler: (() => void) | null = null;
  private _idleId: number | null = null;
  private _loaded = false;

  connectedCallback() {
    const importPath = this.getAttribute('import');
    if (!importPath) {
      console.warn('[nk-island] Missing "import" attribute');
      return;
    }

    if (this.hasAttribute('client:load')) {
      this._loadModule(importPath);
    } else if (this.hasAttribute('client:visible')) {
      this._whenVisible(importPath);
    } else if (this.hasAttribute('client:idle')) {
      this._whenIdle(importPath);
    } else {
      // Check client:media="(query)"
      const mediaQuery = this.getAttribute('client:media');
      if (mediaQuery) {
        this._whenMedia(importPath, mediaQuery);
      } else {
        // No strategy specified — default to load
        this._loadModule(importPath);
      }
    }
  }

  disconnectedCallback() {
    this._cleanup();
  }

  private _whenVisible(importPath: string) {
    this._observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this._loadModule(importPath);
            this._observer?.disconnect();
            this._observer = null;
            break;
          }
        }
      },
      { rootMargin: '200px' }
    );
    this._observer.observe(this);
  }

  private _whenIdle(importPath: string) {
    if ('requestIdleCallback' in window) {
      this._idleId = (window as any).requestIdleCallback(() => {
        this._loadModule(importPath);
        this._idleId = null;
      });
    } else {
      // Fallback for Safari
      setTimeout(() => this._loadModule(importPath), 200);
    }
  }

  private _whenMedia(importPath: string, query: string) {
    this._mediaQuery = window.matchMedia(query);
    if (this._mediaQuery.matches) {
      this._loadModule(importPath);
      return;
    }
    this._mediaHandler = () => {
      if (this._mediaQuery?.matches) {
        this._loadModule(importPath);
        this._cleanupMedia();
      }
    };
    this._mediaQuery.addEventListener('change', this._mediaHandler);
  }

  private async _loadModule(importPath: string) {
    if (this._loaded) return;
    this._loaded = true;
    try {
      await import(/* @vite-ignore */ importPath);
      this.setAttribute('data-hydrated', '');
      this.dispatchEvent(new CustomEvent('island-hydrated', { bubbles: true, composed: true }));
    } catch (err) {
      console.error(`[nk-island] Failed to load module "${importPath}":`, err);
    }
  }

  private _cleanupMedia() {
    if (this._mediaQuery && this._mediaHandler) {
      this._mediaQuery.removeEventListener('change', this._mediaHandler);
      this._mediaQuery = null;
      this._mediaHandler = null;
    }
  }

  private _cleanup() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._idleId !== null) {
      (window as any).cancelIdleCallback(this._idleId);
      this._idleId = null;
    }
    this._cleanupMedia();
  }
}

if (!customElements.get('nk-island')) {
  customElements.define('nk-island', NkIsland);
}
