import { routes } from 'virtual:lumenjs-routes';
import { NkRouter } from './router.js';

type PrefetchStrategy = 'hover' | 'viewport' | 'none';

function getDefaultStrategy(): PrefetchStrategy {
  const el = document.getElementById('__nk_prefetch__');
  if (el) {
    const val = el.textContent?.trim();
    if (val === 'hover' || val === 'viewport' || val === 'none') return val;
  }
  return 'hover';
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

    const observeLinks = (root: Element | Document | ShadowRoot) => {
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
      // Walk shadow roots to find links inside web components
      const els = root.querySelectorAll('*');
      for (const el of els) {
        if (el.shadowRoot) observeLinks(el.shadowRoot);
      }
    };

    const observeShadowRoot = (sr: ShadowRoot) => {
      observeLinks(sr);
      const smo = new MutationObserver(() => observeLinks(sr));
      smo.observe(sr, { childList: true, subtree: true });
    };

    // Observe existing links after initial render (including shadow roots)
    requestAnimationFrame(() => {
      observeLinks(document);
      // Also observe shadow roots of existing elements
      document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) observeShadowRoot(el.shadowRoot);
      });
    });

    // Watch for dynamically added links and new shadow roots
    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.tagName === 'A') {
              observeLinks(node.parentElement || document);
            } else {
              observeLinks(node);
              if (node.shadowRoot) observeShadowRoot(node.shadowRoot);
            }
            // Check children for shadow roots
            node.querySelectorAll?.('*').forEach(child => {
              if (child.shadowRoot) observeShadowRoot(child.shadowRoot);
            });
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

    // Create route announcer for screen readers (WCAG 2.4.2)
    const announcer = document.createElement('div');
    announcer.id = 'nk-route-announcer';
    announcer.setAttribute('aria-live', 'assertive');
    announcer.setAttribute('aria-atomic', 'true');
    announcer.setAttribute('role', 'status');
    Object.assign(announcer.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    this.appendChild(announcer);

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
