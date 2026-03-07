export interface Route {
  path: string;
  tagName: string;
  hasLoader?: boolean;
  load?: () => Promise<any>;
  pattern?: RegExp;
  paramNames?: string[];
}

/**
 * Simple client-side router for LumenJS pages.
 * Handles popstate and link clicks for SPA navigation.
 * Supports server loaders — fetches data before rendering.
 */
export class NkRouter {
  private routes: Route[] = [];
  private outlet: HTMLElement | null = null;
  private currentTag: string | null = null;
  public params: Record<string, string> = {};

  constructor(routes: Route[], outlet: HTMLElement, hydrate = false) {
    this.outlet = outlet;
    this.routes = routes.map(r => ({
      ...r,
      ...this.compilePattern(r.path),
    }));

    window.addEventListener('popstate', () => this.navigate(location.pathname, false));
    document.addEventListener('click', (e) => this.handleLinkClick(e));

    if (hydrate) {
      this.hydrateInitialRoute();
    } else {
      this.navigate(location.pathname, false);
    }
  }

  private compilePattern(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const pattern = path.replace(/:(?:\.\.\.)?([^/]+)/g, (match, name) => {
      paramNames.push(name);
      // Catch-all :...name matches one or more segments
      return match.startsWith(':...') ? '(.+)' : '([^/]+)';
    });
    return { pattern: new RegExp(`^${pattern}$`), paramNames };
  }

  async navigate(pathname: string, pushState = true) {
    const match = this.matchRoute(pathname);
    if (!match) {
      if (this.outlet) this.outlet.innerHTML = this.render404(pathname);
      return;
    }

    if (pushState) {
      history.pushState(null, '', pathname);
    }

    this.params = match.params;

    // Lazy-load the page component if not yet registered
    if (match.route.load && !customElements.get(match.route.tagName)) {
      await match.route.load();
    }

    // Fetch loader data if the route has a server loader
    let loaderData: any = undefined;
    if (match.route.hasLoader) {
      try {
        loaderData = await this.fetchLoaderData(pathname, match.params);
      } catch (err) {
        console.error('[NkRouter] Loader fetch failed:', err);
      }
    }

    this.renderRoute(match.route, loaderData);
  }

  private async hydrateInitialRoute() {
    const match = this.matchRoute(location.pathname);
    if (!match) return;

    // Load the page module so the custom element class is registered for hydration
    if (match.route.load && !customElements.get(match.route.tagName)) {
      await match.route.load();
    }

    this.currentTag = match.route.tagName;
    this.params = match.params;

    // Find the existing SSR-rendered element in the outlet
    const existing = this.outlet?.querySelector(match.route.tagName);
    if (existing) {
      // Read loader data from the SSR data script tag
      const dataScript = document.getElementById('__nk_ssr_data__');
      if (dataScript) {
        try {
          const loaderData = JSON.parse(dataScript.textContent || '');
          (existing as any).loaderData = loaderData;
        } catch { /* ignore parse errors */ }
        dataScript.remove();
      }
      // Set route params as attributes
      for (const [key, value] of Object.entries(this.params)) {
        existing.setAttribute(key, value);
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

  private renderRoute(route: Route, loaderData?: any) {
    if (!this.outlet) return;
    if (this.currentTag === route.tagName && !loaderData) return;

    this.currentTag = route.tagName;
    this.outlet.innerHTML = '';
    const el = document.createElement(route.tagName);
    // Pass route params as attributes
    for (const [key, value] of Object.entries(this.params)) {
      el.setAttribute(key, value);
    }
    // Pass loader data as a property
    if (loaderData !== undefined) {
      (el as any).loaderData = loaderData;
    }
    this.outlet.appendChild(el);
  }

  private async fetchLoaderData(pathname: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`/__nk_loader${pathname}`, location.origin);
    if (Object.keys(params).length > 0) {
      url.searchParams.set('__params', JSON.stringify(params));
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Loader returned ${res.status}`);
    }
    const data = await res.json();
    if (data?.__nk_no_loader) return undefined;
    return data;
  }

  private render404(pathname: string): string {
    return `<div style="display:flex;align-items:center;justify-content:center;min-height:80vh;font-family:system-ui,-apple-system,sans-serif;padding:2rem">
  <div style="text-align:center;max-width:400px">
    <div style="font-size:5rem;font-weight:200;letter-spacing:-2px;color:#cbd5e1;line-height:1">404</div>
    <div style="width:32px;height:2px;background:#e2e8f0;border-radius:1px;margin:1.25rem auto"></div>
    <h1 style="font-size:1rem;font-weight:500;color:#334155;margin:1.25rem 0 .5rem">Page not found</h1>
    <p style="color:#94a3b8;font-size:.8125rem;line-height:1.5;margin:0 0 2rem"><code style="background:#f8fafc;padding:.125rem .375rem;border-radius:3px;font-size:.75rem;color:#64748b;border:1px solid #f1f5f9">${pathname}</code> doesn't exist</p>
    <a href="/" style="display:inline-flex;align-items:center;gap:.375rem;padding:.4375rem 1rem;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;border-radius:6px;font-size:.8125rem;font-weight:400;text-decoration:none;transition:all .15s">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      Back to home
    </a>
  </div>
</div>`;
  }

  private handleLinkClick(event: MouseEvent) {
    // Use composedPath to find <a> inside Shadow DOM
    const path = event.composedPath();
    const anchor = path.find(
      (el) => el instanceof HTMLElement && el.tagName === 'A'
    ) as HTMLAnchorElement | undefined;
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || anchor.hasAttribute('target')) return;

    event.preventDefault();
    this.navigate(href);
  }
}
