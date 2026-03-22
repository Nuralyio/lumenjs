import { routes } from 'virtual:lumenjs-routes';
import { NkRouter } from './router.js';

type PrefetchStrategy = 'hover' | 'viewport' | 'none';

function getDefaultStrategy(): PrefetchStrategy {
  const el = document.getElementById('__nk_prefetch__');
  if (el) {
    const val = el.textContent?.trim();
    if (val === 'hover' || val === 'viewport' || val === 'none') return val;
  }
  return 'viewport';
}

function getAnchorHref(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#') || anchor.hasAttribute('target')) return null;
  return href;
}

function getLinkStrategy(anchor: HTMLAnchorElement, defaultStrategy: PrefetchStrategy): PrefetchStrategy {
  const override = anchor.dataset.prefetch as PrefetchStrategy | undefined;
  if (override === 'hover' || override === 'viewport' || override === 'none') return override;
  return defaultStrategy;
}

function setupPrefetchObserver(defaultStrategy: PrefetchStrategy): void {
  const prefetched = new Set<string>();

  const doPrefetch = (href: string) => {
    if (prefetched.has(href)) return;
    prefetched.add(href);
    const pf = (window as any).__nk_prefetch;
    if (pf) pf(href);
  };

  // Hover strategy: event delegation on document
  if (defaultStrategy === 'hover' || defaultStrategy === 'viewport') {
    const onPointerEnter = (e: Event) => {
      const path = e.composedPath();
      const anchor = path.find(el => el instanceof HTMLElement && el.tagName === 'A') as HTMLAnchorElement | undefined;
      if (!anchor) return;
      const href = getAnchorHref(anchor);
      if (!href) return;
      const strategy = getLinkStrategy(anchor, defaultStrategy);
      if (strategy === 'none') return;
      if (strategy === 'hover') doPrefetch(href);
    };

    document.addEventListener('pointerenter', onPointerEnter, true);
    document.addEventListener('focusin', (e: Event) => {
      const target = e.target;
      if (target instanceof HTMLAnchorElement) {
        const href = getAnchorHref(target);
        if (!href) return;
        const strategy = getLinkStrategy(target, defaultStrategy);
        if (strategy === 'none') return;
        if (strategy === 'hover') doPrefetch(href);
      }
    });
  }

  // Viewport strategy: IntersectionObserver for links
  if (defaultStrategy === 'viewport') {
    const observedLinks = new WeakSet<HTMLAnchorElement>();

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const anchor = entry.target as HTMLAnchorElement;
        const href = getAnchorHref(anchor);
        if (!href) continue;
        const strategy = getLinkStrategy(anchor, defaultStrategy);
        if (strategy === 'none' || strategy === 'hover') continue;
        doPrefetch(href);
        io.unobserve(anchor);
      }
    }, { rootMargin: '200px' });

    const observeLinks = (root: Element | Document) => {
      const anchors = root.querySelectorAll('a[href]');
      for (const a of anchors) {
        const anchor = a as HTMLAnchorElement;
        if (observedLinks.has(anchor)) continue;
        const href = getAnchorHref(anchor);
        if (!href) continue;
        const strategy = getLinkStrategy(anchor, defaultStrategy);
        if (strategy !== 'viewport') continue;
        observedLinks.add(anchor);
        io.observe(anchor);
      }
    };

    // Observe existing links after initial render
    requestAnimationFrame(() => observeLinks(document));

    // Watch for dynamically added links
    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.tagName === 'A') {
              observeLinks(node.parentElement || document);
            } else {
              observeLinks(node);
            }
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
}

/**
 * <nk-app> — The application shell. Sets up the router and renders pages.
 */
class NkApp extends HTMLElement {
  private router: NkRouter | null = null;

  connectedCallback() {
    const isSSR = this.hasAttribute('data-nk-ssr');
    if (!isSSR) {
      this.innerHTML = '<div id="nk-router-outlet"></div>';
    }
    const outlet = this.querySelector('#nk-router-outlet') as HTMLElement;
    this.router = new NkRouter(routes, outlet, isSSR);

    const strategy = getDefaultStrategy();
    if (strategy !== 'none') {
      setupPrefetchObserver(strategy);
    }
  }
}

if (!customElements.get('nk-app')) {
  customElements.define('nk-app', NkApp);
}
