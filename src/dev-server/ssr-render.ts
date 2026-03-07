import { ViteDevServer } from 'vite';
import { resolvePageFile, extractRouteParams } from './vite-plugin-loaders.js';

/**
 * Server-side render a LumenJS page using @lit-labs/ssr.
 *
 * All modules (Lit, @lit-labs/ssr, page) are loaded through Vite's ssrLoadModule
 * to ensure they share a single module registry and Lit instance.
 *
 * Returns pre-rendered HTML and loader data, or null on failure (falls back to CSR).
 */
export async function ssrRenderPage(
  server: ViteDevServer, pagesDir: string, pathname: string, headers?: Record<string, string | string[] | undefined>
): Promise<{ html: string; loaderData: any; redirect?: { location: string; status: number } } | null> {
  try {
    const filePath = resolvePageFile(pagesDir, pathname);
    if (!filePath) return null;

    const params = extractRouteParams(pagesDir, pathname, filePath);

    // Install @lit-labs/ssr DOM shim via Vite's SSR module loader
    // This must happen before loading the page module
    await server.ssrLoadModule('@lit-labs/ssr/lib/install-global-dom-shim.js');

    // Patch missing DOM APIs that NuralyUI components may use during SSR
    const g = globalThis as any;
    const noop = () => null;
    const noopEl = { getAttribute: noop, setAttribute: noop, removeAttribute: noop, closest: noop };
    if (g.HTMLElement && !g.HTMLElement.prototype.closest) {
      g.HTMLElement.prototype.closest = noop;
    }
    if (g.HTMLElement && !g.HTMLElement.prototype.querySelector) {
      g.HTMLElement.prototype.querySelector = noop;
    }
    if (g.HTMLElement && !g.HTMLElement.prototype.querySelectorAll) {
      g.HTMLElement.prototype.querySelectorAll = () => [];
    }
    if (g.document && !g.document.documentElement) {
      g.document.documentElement = noopEl;
    }
    if (!g.window?.matchMedia) {
      g.window = g.window || g;
      g.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
    }

    // Load the page module via Vite (registers the custom element, applies transforms)
    const mod = await server.ssrLoadModule(filePath);

    // Run loader if present
    let loaderData: any = undefined;
    if (mod.loader && typeof mod.loader === 'function') {
      loaderData = await mod.loader({ params, query: {}, url: pathname, headers: headers || {} });
      if (loaderData && typeof loaderData === 'object' && loaderData.__nk_redirect) {
        return { html: '', loaderData: null, redirect: { location: loaderData.location, status: loaderData.status || 302 } };
      }
    }

    // Determine the custom element tag name
    const tagName = findTagName(mod);
    if (!tagName) return null;

    // Load SSR render + lit/static-html.js through Vite (same module registry as page)
    const { render } = await server.ssrLoadModule('@lit-labs/ssr');
    const { html, unsafeStatic } = await server.ssrLoadModule('lit/static-html.js');

    const tag = unsafeStatic(tagName);
    const templateResult = html`<${tag} .loaderData=${loaderData}></${tag}>`;
    const ssrResult = render(templateResult);

    let htmlStr = '';
    for (const chunk of ssrResult) {
      htmlStr += typeof chunk === 'string' ? chunk : String(chunk);
    }

    return { html: htmlStr, loaderData };
  } catch (err) {
    console.error('[LumenJS] SSR render failed, falling back to CSR:', err);
    return null;
  }
}

/**
 * Find the custom element tag name from a page module.
 * Pages use @customElement('page-xxx') which registers the element.
 */
function findTagName(mod: Record<string, any>): string | null {
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (typeof val === 'function' && val.prototype) {
      // Lit elements set a static `is` property via @customElement decorator
      if (val.is) return val.is;
      // Fallback: derive tag from PascalCase class name → kebab-case
      if (val.elementProperties || val.properties) {
        const className = val.name || key;
        const tag = className
          .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
          .toLowerCase();
        if (tag.includes('-')) return tag;
      }
    }
  }
  return null;
}
