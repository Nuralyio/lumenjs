import { fetchLoaderData, fetchLayoutLoaderData, prefetchLoaderData, prefetchLayoutLoaderData, connectSubscribe, connectLayoutSubscribe, render404 } from './router-data.js';
import { hydrateInitialRoute } from './router-hydration.js';
import { getI18nConfig, getLocale, initI18n, stripLocalePrefix, buildLocalePath } from './i18n.js';
import type { PageMeta } from '../shared/meta.js';

export interface LayoutInfo {
  tagName: string;
  hasLoader?: boolean;
  hasSubscribe?: boolean;
  load?: () => Promise<any>;
  loaderPath?: string;
}

export interface Route {
  path: string;
  tagName: string;
  hasLoader?: boolean;
  hasSubscribe?: boolean;
  hasMeta?: boolean;
  load?: () => Promise<any>;
  layouts?: LayoutInfo[];
  pattern?: RegExp;
  paramNames?: string[];
}

/**
 * Simple client-side router for LumenJS pages.
 * Handles popstate and link clicks for SPA navigation.
 * Supports server loaders and nested layouts with persistence.
 */
export class NkRouter {
  private routes: Route[] = [];
  private outlet: HTMLElement | null = null;
  private currentTag: string | null = null;
  private currentLayoutTags: string[] = [];
  private subscriptions: EventSource[] = [];
  private siteTitle: string;
  public params: Record<string, string> = {};

  constructor(routes: Route[], outlet: HTMLElement, hydrate = false) {
    this.outlet = outlet;
    this.siteTitle = document.title || 'LumenJS App';
    this.routes = routes.map(r => ({
      ...r,
      ...this.compilePattern(r.path),
    }));

    // Initialize i18n from inlined data before any rendering
    const i18nScript = document.getElementById('__nk_i18n__');
    if (i18nScript) {
      try {
        const i18nData = JSON.parse(i18nScript.textContent || '');
        initI18n(i18nData.config, i18nData.locale, i18nData.translations);
      } catch { /* ignore */ }
      if (!hydrate) i18nScript.remove();
    }

    window.addEventListener('popstate', () => {
      const path = this.stripLocale(location.pathname);
      this.navigate(path, false);
    });
    // Re-run loader when page is restored from bfcache (back/forward on mobile Safari, etc.)
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        const path = this.stripLocale(location.pathname);
        this.navigate(path, false);
      }
    });
    document.addEventListener('click', (e) => this.handleLinkClick(e));
    (window as any).__nk_navigate = (href: string) => {
      const path = this.stripLocale(href);
      if (this.matchRoute(path.split('?')[0])) {
        this.navigate(path);
      } else {
        window.location.href = href;
      }
    };
    (window as any).__nk_prefetch = (href: string) => {
      const path = this.stripLocale(href);
      this.prefetch(path);
    };

    if (hydrate) {
      hydrateInitialRoute(
        this.routes,
        this.outlet,
        (p) => this.matchRoute(p),
        (tag, layoutTags, params) => {
          this.currentTag = tag;
          this.currentLayoutTags = layoutTags;
          this.params = params;
        }
      );
      // Wire up SSE subscriptions after hydration
      const path = this.stripLocale(location.pathname);
      this.setupSubscriptions(path);
    } else {
      // Initialize auth from inlined data before navigating (CSR path)
      const authScript = document.getElementById('__nk_auth__');
      if (authScript) {
        import('@lumenjs/auth').then(({ initAuth }) => {
          try { initAuth(JSON.parse(authScript.textContent || '')); } catch {}
          authScript.remove();
        }).catch(() => {}).finally(() => {
          const path = this.stripLocale(location.pathname);
          this.navigate(path, false);
        });
      } else {
        const path = this.stripLocale(location.pathname);
        this.navigate(path, false);
      }
    }
  }

  private compilePattern(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const pattern = path.replace(/:(?:\.\.\.)?([^/]+)/g, (match, name) => {
      paramNames.push(name);
      return match.startsWith(':...') ? '(.+)' : '([^/]+)';
    });
    return { pattern: new RegExp(`^${pattern}$`), paramNames };
  }

  private cleanupSubscriptions(): void {
    for (const es of this.subscriptions) {
      es.close();
    }
    this.subscriptions = [];
  }

  async navigate(fullPath: string, pushState = true) {
    this.cleanupSubscriptions();

    const pathname = fullPath.split('?')[0];
    const match = this.matchRoute(pathname);
    if (!match) {
      if (this.outlet) this.outlet.innerHTML = render404(pathname);
      this.currentLayoutTags = [];
      this.currentTag = null;
      return;
    }

    if (pushState) {
      const localePath = this.withLocale(fullPath);
      history.pushState(null, '', localePath);
      window.scrollTo(0, 0);
    }

    this.params = match.params;

    // Auth guard: SPA-navigate unauthenticated users to login page
    if ((match.route as any).__nk_has_auth) {
      try {
        const { isAuthenticated } = await import('@lumenjs/auth');
        if (!isAuthenticated()) {
          const loginPath = '/auth/login';
          const loginUrl = `${loginPath}?returnTo=${encodeURIComponent(pathname)}`;
          history.pushState(null, '', loginUrl);
          this.navigate(loginPath, false);
          return;
        }
      } catch {}
    }

    const layouts = match.route.layouts || [];

    // Load all component JS chunks in parallel
    await Promise.all([
      match.route.load && !customElements.get(match.route.tagName) ? match.route.load() : undefined,
      ...layouts.map(l => l.load && !customElements.get(l.tagName) ? l.load() : undefined),
    ]);

    // Fetch all loader data in parallel
    const loaderPromises: Promise<any>[] = [
      match.route.hasLoader
        ? fetchLoaderData(pathname, match.params).catch(err => { console.error('[NkRouter] Loader fetch failed:', err); return undefined; })
        : Promise.resolve(undefined),
      ...layouts.map(layout =>
        layout.hasLoader
          ? fetchLayoutLoaderData(layout.loaderPath || '').catch(err => { console.error('[NkRouter] Layout loader fetch failed:', err); return undefined; })
          : Promise.resolve(undefined)
      ),
    ];

    const [loaderData, ...layoutDataList] = await Promise.all(loaderPromises);

    this.renderRoute(match.route, loaderData, layouts, layoutDataList);

    // Update document.title and announce route change for screen readers
    this.updatePageMeta(match.route, loaderData);

    // Set up SSE subscriptions
    this.setupSubscriptions(pathname);
  }

  private setupSubscriptions(pathname: string): void {
    const match = this.matchRoute(pathname);
    if (!match) return;

    const layouts = match.route.layouts || [];

    // Page subscription
    if (match.route.hasSubscribe) {
      const es = connectSubscribe(pathname, match.params);
      es.onmessage = (e) => {
        const pageEl = this.findPageElement(match.route.tagName);
        if (pageEl) (pageEl as any).liveData = JSON.parse(e.data);
      };
      this.subscriptions.push(es);
    }

    // Layout subscriptions
    for (const layout of layouts) {
      if (layout.hasSubscribe) {
        const es = connectLayoutSubscribe(layout.loaderPath || '');
        es.onmessage = (e) => {
          const layoutEl = this.outlet?.querySelector(layout.tagName);
          if (layoutEl) (layoutEl as any).liveData = JSON.parse(e.data);
        };
        this.subscriptions.push(es);
      }
    }
  }

  private matchRoute(pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (!route.pattern) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames?.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        return { route, params };
      }
    }
    return null;
  }

  private renderRoute(route: Route, loaderData?: any, layouts?: LayoutInfo[], layoutDataList?: any[]): void {
    if (!this.outlet) return;

    const newLayoutTags = (layouts || []).map(l => l.tagName);

    // Find the first layout that differs from the current chain
    let divergeIndex = 0;
    while (
      divergeIndex < this.currentLayoutTags.length &&
      divergeIndex < newLayoutTags.length &&
      this.currentLayoutTags[divergeIndex] === newLayoutTags[divergeIndex]
    ) {
      divergeIndex++;
    }

    const canReuse = this.currentLayoutTags.length > 0 && divergeIndex > 0;

    if (!canReuse || divergeIndex === 0) {
      // Full re-render: no layouts to reuse
      this.outlet.innerHTML = '';

      if (newLayoutTags.length === 0) {
        const pageEl = this.createPageElement(route, loaderData);
        this.outlet.appendChild(pageEl);
      } else {
        const tree = this.buildLayoutTree(layouts!, layoutDataList || [], route, loaderData);
        this.outlet.appendChild(tree);
      }
    } else {
      // Reuse layouts up to divergeIndex, rebuild from there
      let parentEl: Element | null = this.outlet;
      for (let i = 0; i < divergeIndex; i++) {
        const layoutEl: Element | null = parentEl?.querySelector(`:scope > ${this.currentLayoutTags[i]}`) ?? null;
        if (!layoutEl) {
          return this.renderRoute(route, loaderData, [], []);
        }
        if (layoutDataList && layoutDataList[i] !== undefined) {
          (layoutEl as any).loaderData = layoutDataList[i];
          this.spreadData(layoutEl, layoutDataList[i]);
        }
        parentEl = layoutEl;
      }

      if (!parentEl) return;

      parentEl.innerHTML = '';

      if (divergeIndex >= newLayoutTags.length) {
        const pageEl = this.createPageElement(route, loaderData);
        parentEl.appendChild(pageEl);
      } else {
        const remainingLayouts = layouts!.slice(divergeIndex);
        const remainingData = (layoutDataList || []).slice(divergeIndex);
        const tree = this.buildLayoutTree(remainingLayouts, remainingData, route, loaderData);
        parentEl.appendChild(tree);
      }
    }

    this.currentTag = route.tagName;
    this.currentLayoutTags = newLayoutTags;
  }

  private buildLayoutTree(layouts: LayoutInfo[], layoutDataList: any[], route: Route, loaderData?: any): HTMLElement {
    const outerLayout = document.createElement(layouts[0].tagName);
    if (layoutDataList[0] !== undefined) {
      (outerLayout as any).loaderData = layoutDataList[0];
      this.spreadData(outerLayout, layoutDataList[0]);
    }

    let current = outerLayout;
    for (let i = 1; i < layouts.length; i++) {
      const inner = document.createElement(layouts[i].tagName);
      if (layoutDataList[i] !== undefined) {
        (inner as any).loaderData = layoutDataList[i];
        this.spreadData(inner, layoutDataList[i]);
      }
      current.appendChild(inner);
      current = inner;
    }

    const pageEl = this.createPageElement(route, loaderData);
    current.appendChild(pageEl);

    return outerLayout;
  }

  /** Spread loader data as individual properties on an element. */
  private spreadData(el: Element, data: any): void {
    if (data && typeof data === 'object') {
      const BLOCKED = new Set(['__proto__', 'constructor', 'prototype',
        'innerHTML', 'outerHTML', 'textContent',
        'render', 'connectedCallback', 'disconnectedCallback']);
      for (const [key, value] of Object.entries(data)) {
        if (!BLOCKED.has(key)) {
          (el as any)[key] = value;
        }
      }
    }
  }

  private createPageElement(route: Route, loaderData?: any): HTMLElement {
    const el = document.createElement(route.tagName);
    for (const [key, value] of Object.entries(this.params)) {
      el.setAttribute(key, value);
    }
    if (loaderData !== undefined) {
      (el as any).loaderData = loaderData;
      this.spreadData(el, loaderData);
    }
    return el;
  }

  private findPageElement(tagName: string): Element | null {
    if (!this.outlet) return null;
    return this.outlet.querySelector(tagName) ?? this.outlet.querySelector(`${tagName}:last-child`);
  }

  /**
   * Resolve the page title from the route's meta export and update
   * document.title, the aria-live announcer, and focus.
   */
  private async updatePageMeta(route: Route, loaderData?: any): Promise<void> {
    let pageTitle: string | undefined;

    if (route.hasMeta && route.load) {
      try {
        const mod = await route.load();
        if (mod) {
          let meta: PageMeta | undefined;
          if (typeof mod.meta === 'function') {
            meta = mod.meta({ data: loaderData, params: this.params });
          } else if (mod.meta && typeof mod.meta === 'object') {
            meta = mod.meta;
          }
          if (meta?.title) {
            pageTitle = `${meta.title} | ${this.siteTitle}`;
          }
        }
      } catch { /* fall back to site title */ }
    }

    const title = pageTitle || this.siteTitle;
    document.title = title;

    // Announce route change to screen readers
    const announcer = document.getElementById('nk-route-announcer');
    if (announcer) {
      announcer.textContent = '';
      // Use a microtask delay so aria-live picks up the change
      requestAnimationFrame(() => { announcer.textContent = title; });
    }

    // Move focus to the router outlet for keyboard/screen reader users
    if (this.outlet) {
      if (!this.outlet.hasAttribute('tabindex')) {
        this.outlet.setAttribute('tabindex', '-1');
      }
      this.outlet.focus({ preventScroll: true });
    }
  }

  private handleLinkClick(event: MouseEvent) {
    const path = event.composedPath();
    const anchor = path.find(
      (el) => el instanceof HTMLElement && el.tagName === 'A'
    ) as HTMLAnchorElement | undefined;
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || anchor.hasAttribute('target')) return;

    // Allow modifier-key clicks to behave normally (Ctrl+Click = new tab, etc.)
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    this.navigate(this.stripLocale(href));
  }

  async prefetch(fullPath: string): Promise<void> {
    const pathname = fullPath.split('?')[0];
    const match = this.matchRoute(pathname);
    if (!match) return;

    const layouts = match.route.layouts || [];

    await Promise.all([
      // Preload component JS chunks
      match.route.load && !customElements.get(match.route.tagName) ? match.route.load() : undefined,
      ...layouts.map(l => l.load && !customElements.get(l.tagName) ? l.load() : undefined),
      // Prefetch loader data (cached)
      match.route.hasLoader ? prefetchLoaderData(pathname, match.params).catch(() => {}) : undefined,
      ...layouts.map(l => l.hasLoader ? prefetchLayoutLoaderData(l.loaderPath || '').catch(() => {}) : undefined),
    ]);
  }

  /** Strip locale prefix from a path for internal route matching. */
  private stripLocale(path: string): string {
    const config = getI18nConfig();
    return config ? stripLocalePrefix(path) : path;
  }

  /** Prepend locale prefix for browser-facing URLs. */
  private withLocale(path: string): string {
    const config = getI18nConfig();
    return config ? buildLocalePath(getLocale(), path) : path;
  }
}

/** Navigate via the client-side router. Falls back to full reload for unknown routes. */
export function navigate(href: string): void {
  const nav = (window as any).__nk_navigate;
  if (nav) {
    nav(href);
  } else {
    window.location.href = href;
  }
}

/** Programmatically prefetch a route's JS chunks and loader data. */
export function prefetch(href: string): void {
  const pf = (window as any).__nk_prefetch;
  if (pf) pf(href);
}
