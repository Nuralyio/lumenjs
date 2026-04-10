import type { Route, LayoutInfo } from './router.js';
import { initI18n, stripLocalePrefix, getI18nConfig } from './i18n.js';

/**
 * Hydrate the initial SSR-rendered route.
 * Sets loaderData on existing DOM elements BEFORE loading modules to avoid
 * hydration mismatches with Lit's microtask-based hydration.
 */
export async function hydrateInitialRoute(
  routes: Route[],
  outlet: HTMLElement | null,
  matchRoute: (pathname: string) => { route: Route; params: Record<string, string> } | null,
  onHydrated: (tag: string, layoutTags: string[], params: Record<string, string>) => void
): Promise<void> {
  // Read i18n data and init before anything else
  const i18nScript = document.getElementById('__nk_i18n__');
  if (i18nScript) {
    try {
      const i18nData = JSON.parse(i18nScript.textContent || '');
      initI18n(i18nData.config, i18nData.locale, i18nData.translations);
    } catch { /* ignore */ }
    i18nScript.remove();
  }

  // Read auth data and init before route matching
  const authScript = document.getElementById('__nk_auth__');
  if (authScript) {
    try {
      const { initAuth } = await import('@lumenjs/auth');
      initAuth(JSON.parse(authScript.textContent || ''));
    } catch {}
    authScript.remove();
  }

  // Strip Vite base path and locale prefix for route matching
  let matchPath = location.pathname;
  const base = (import.meta as any).env?.BASE_URL;
  if (base && base !== '/' && matchPath.startsWith(base)) {
    matchPath = '/' + matchPath.slice(base.length);
  }
  const config = getI18nConfig();
  if (config) {
    matchPath = stripLocalePrefix(matchPath);
  }

  const match = matchRoute(matchPath);
  if (!match) return;

  const layouts = match.route.layouts || [];
  const params = match.params;

  // Read SSR data FIRST — we need it before loading modules, because
  // loading a module registers the custom element which triggers Lit
  // hydration as a microtask. If loaderData isn't set before the next
  // await, the element hydrates with default values → mismatch.
  let ssrData: any = null;
  const dataScript = document.getElementById('__nk_ssr_data__');
  if (dataScript) {
    try {
      ssrData = JSON.parse(dataScript.textContent || '');
    } catch { /* ignore parse errors */ }
    dataScript.remove();
  }

  // Build a map of loaderPath → data for quick lookup
  const layoutDataMap = new Map<string, any>();
  if (ssrData?.layouts && Array.isArray(ssrData.layouts)) {
    for (const entry of ssrData.layouts) {
      if (entry.data !== undefined) {
        layoutDataMap.set(entry.loaderPath, entry.data);
      }
    }
  }

  /** Spread loader data as individual properties on an element. */
  const BLOCKED = new Set(['__proto__', 'constructor', 'prototype',
    'innerHTML', 'outerHTML', 'textContent',
    'render', 'connectedCallback', 'disconnectedCallback']);
  function spreadData(el: Element, data: any): void {
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (!BLOCKED.has(key)) {
          (el as any)[key] = value;
        }
      }
    }
  }

  // Load each layout module and immediately set loaderData on the
  // existing DOM element BEFORE the next await yields to microtasks.
  for (const layout of layouts) {
    const existingLayout = outlet?.querySelector(layout.tagName);
    if (existingLayout) {
      const data = layoutDataMap.get(layout.loaderPath ?? '');
      if (data !== undefined) {
        (existingLayout as any).loaderData = data;
        spreadData(existingLayout, data);
      }
    }

    if (layout.load && !customElements.get(layout.tagName)) {
      await layout.load();
    }
  }

  // Set component loaderData BEFORE loading modules
  if (ssrData?.components && Array.isArray(ssrData.components)) {
    for (const comp of ssrData.components) {
      if (comp.tagName && comp.data !== undefined) {
        const els = outlet?.querySelectorAll(comp.tagName);
        if (els) {
          for (const el of els) {
            (el as any).loaderData = comp.data;
            spreadData(el, comp.data);
          }
        }
      }
    }
  }

  // Set page loaderData BEFORE loading the page module
  const pageData = ssrData?.page !== undefined ? ssrData.page
    : (ssrData && !ssrData.layouts) ? ssrData
    : undefined;
  const existingPage = outlet?.querySelector(match.route.tagName);
  if (existingPage && pageData !== undefined) {
    (existingPage as any).loaderData = pageData;
    spreadData(existingPage, pageData);
  }

  // Load the page module (registers element, triggers hydration microtask)
  if (match.route.load && !customElements.get(match.route.tagName)) {
    await match.route.load();
  }

  // Set route params as attributes on the page element
  const pageEl = outlet?.querySelector(match.route.tagName);
  if (pageEl) {
    for (const [key, value] of Object.entries(params)) {
      pageEl.setAttribute(key, value);
    }
  }

  onHydrated(match.route.tagName, layouts.map(l => l.tagName), params);
}
