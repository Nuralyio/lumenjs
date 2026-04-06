import { ViteDevServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { resolvePageFile, extractRouteParams } from './plugins/vite-plugin-loaders.js';
import { stripOuterLitMarkers, dirToLayoutTagName, filePathToTagName, patchLoaderDataSpread } from '../shared/utils.js';
import { installDomShims } from '../shared/dom-shims.js';
import { loadTranslationsFromDisk } from './plugins/vite-plugin-i18n.js';

export interface LayoutSSRData {
  loaderPath: string;
  data: any;
}

/**
 * Server-side render a LumenJS page using @lit-labs/ssr.
 * Wraps the page in its layout chain if layouts exist.
 *
 * Returns pre-rendered HTML and loader data, or null on failure (falls back to CSR).
 */
export async function ssrRenderPage(
  server: ViteDevServer, pagesDir: string, pathname: string, headers?: Record<string, string | string[] | undefined>, locale?: string, user?: any
): Promise<{ html: string; loaderData: any; layoutsData?: LayoutSSRData[]; redirect?: { location: string; status: number }; authUser?: any } | null> {
  try {
    const filePath = resolvePageFile(pagesDir, pathname);
    if (!filePath) return null;

    const params = extractRouteParams(pagesDir, pathname, filePath);

    // Install @lit-labs/ssr DOM shim via Vite's SSR module loader
    await server.ssrLoadModule('@lit-labs/ssr/lib/install-global-dom-shim.js');

    // Patch missing DOM APIs that NuralyUI components may use during SSR
    installDomShims();

    // Invalidate SSR module cache so we always get fresh content after file edits.
    // Also clear the custom element from the SSR registry so the new class is used.
    // IMPORTANT: This must happen BEFORE i18n/auth init, because invalidation
    // recursively clears all SSR-imported modules (including @lumenjs/i18n).
    // If we init i18n first, then invalidate, the page reload gets a fresh i18n
    // module instance with empty translations.
    const g = globalThis as any;
    invalidateSsrModule(server, filePath);
    clearSsrCustomElement(g);

    // Use root-relative paths for ssrLoadModule so the module graph entry
    // gets url='/pages/index.ts' instead of the filesystem path. Vite's
    // idToModuleMap is shared between SSR and client — if SSR creates the
    // entry first with a filesystem-path URL, the client inherits it and
    // HMR breaks (createHotContext gets the wrong path).
    const projectRoot = path.resolve(pagesDir, '..');
    const pageModuleUrl = '/' + path.relative(projectRoot, filePath).replace(/\\/g, '/');

    // Load the page module via Vite (registers the custom element, applies transforms)
    // Bypass get() so auto-define re-registers fresh classes
    const registry = g.customElements;
    if (registry) registry.__nk_bypass_get = true;
    const mod = await server.ssrLoadModule(pageModuleUrl);
    if (registry) registry.__nk_bypass_get = false;

    // Run loader if present
    let loaderData: any = undefined;
    if (mod.loader && typeof mod.loader === 'function') {
      loaderData = await mod.loader({ params, query: {}, url: pathname, headers: headers || {}, locale, user: user ?? null });
      if (loaderData && typeof loaderData === 'object' && loaderData.__nk_redirect) {
        return { html: '', loaderData: null, redirect: { location: loaderData.location, status: loaderData.status || 302 } };
      }
    }

    // Determine the custom element tag name from file path (matches client router)
    const relPath = path.relative(pagesDir, filePath).replace(/\\/g, '/');
    const tagName = filePathToTagName(relPath);

    // Standalone pages skip all layouts
    const layoutChain = mod.standalone ? [] : discoverLayoutChain(pagesDir, filePath);
    const layoutsData: LayoutSSRData[] = [];

    // Load layout modules and run their loaders
    const layoutModules: Array<{ tagName: string; loaderData: any }> = [];
    for (const layout of layoutChain) {
      // Invalidate layout module cache and clear SSR element registry
      invalidateSsrModule(server, layout.filePath);
      clearSsrCustomElement(g);

      const layoutModuleUrl = '/' + path.relative(projectRoot, layout.filePath).replace(/\\/g, '/');
      if (registry) registry.__nk_bypass_get = true;
      const layoutMod = await server.ssrLoadModule(layoutModuleUrl);
      if (registry) registry.__nk_bypass_get = false;
      let layoutLoaderData: any = undefined;

      if (layoutMod.loader && typeof layoutMod.loader === 'function') {
        layoutLoaderData = await layoutMod.loader({ params: {}, query: {}, url: pathname, headers: headers || {}, locale, user: user ?? null });
        if (layoutLoaderData && typeof layoutLoaderData === 'object' && layoutLoaderData.__nk_redirect) {
          return { html: '', loaderData: null, redirect: { location: layoutLoaderData.location, status: layoutLoaderData.status || 302 } };
        }
      }

      const layoutTagName = dirToLayoutTagName(layout.dir);
      layoutModules.push({ tagName: layoutTagName, loaderData: layoutLoaderData });
      layoutsData.push({ loaderPath: layout.dir, data: layoutLoaderData });
    }

    // Patch element classes to spread loaderData into individual properties
    for (const lm of layoutModules) {
      patchLoaderDataSpread(lm.tagName);
    }
    patchLoaderDataSpread(tagName);

    // Initialize i18n in the SSR context AFTER all page/layout modules are loaded.
    // This ensures t() uses the same module instance the components imported.
    // Must happen after invalidation + module loading, because invalidateSsrModule
    // recursively clears cached modules — if i18n was initialized before, the
    // reloaded page/layout would get a fresh i18n instance with empty translations.
    if (locale) {
      const projectDir = path.resolve(pagesDir, '..');
      const translations = loadTranslationsFromDisk(projectDir, locale);
      try {
        const i18nMod = await server.ssrLoadModule('@lumenjs/i18n');
        if (i18nMod?.initI18n) {
          i18nMod.initI18n({ locales: [], defaultLocale: locale, prefixDefault: false }, locale, translations);
        }
      } catch {
        // i18n module not available — translations will show keys
      }
    }

    // Initialize auth in the SSR context (same reason — after module loading)
    if (user) {
      try {
        const authMod = await server.ssrLoadModule('@nuraly/lumenjs-auth');
        if (authMod?.initAuth) authMod.initAuth(user);
      } catch {}
    }

    // Load SSR render + lit/static-html.js through Vite (same module registry as page)
    const { render } = await server.ssrLoadModule('@lit-labs/ssr');
    const { html, unsafeStatic } = await server.ssrLoadModule('lit/static-html.js');

    // Render each element separately to avoid nesting Lit template markers.
    const pageTag = unsafeStatic(tagName);
    const pageTemplate = html`<${pageTag} .loaderData=${loaderData}></${pageTag}>`;
    let pageHtml = '';
    for (const chunk of render(pageTemplate)) {
      pageHtml += typeof chunk === 'string' ? chunk : String(chunk);
    }
    pageHtml = stripOuterLitMarkers(pageHtml);

    let htmlStr = pageHtml;
    for (let i = layoutModules.length - 1; i >= 0; i--) {
      const layoutTag = unsafeStatic(layoutModules[i].tagName);
      const layoutData = layoutModules[i].loaderData;
      const layoutTemplate = html`<${layoutTag} .loaderData=${layoutData}></${layoutTag}>`;
      let layoutHtml = '';
      for (const chunk of render(layoutTemplate)) {
        layoutHtml += typeof chunk === 'string' ? chunk : String(chunk);
      }
      if (i > 0) {
        layoutHtml = stripOuterLitMarkers(layoutHtml);
      }
      const closingTag = `</${layoutModules[i].tagName}>`;
      const closingIdx = layoutHtml.lastIndexOf(closingTag);
      if (closingIdx !== -1) {
        htmlStr = layoutHtml.slice(0, closingIdx) + htmlStr + layoutHtml.slice(closingIdx);
      } else {
        htmlStr = layoutHtml + htmlStr;
      }
    }

    return { html: htmlStr, loaderData, layoutsData: layoutsData.length > 0 ? layoutsData : undefined, authUser: user ?? undefined };
  } catch (err) {
    console.error('[LumenJS] SSR render failed, falling back to CSR:', err);
    return null;
  }
}

/**
 * Discover layout files for a given page, from root → deepest directory.
 */
function discoverLayoutChain(pagesDir: string, pageFilePath: string): Array<{ dir: string; filePath: string }> {
  const relativeToPages = path.relative(pagesDir, pageFilePath).replace(/\\/g, '/');
  const dirParts = path.dirname(relativeToPages).split('/').filter(p => p && p !== '.');

  const chain: Array<{ dir: string; filePath: string }> = [];

  // Check root layout
  const rootLayout = findLayoutFile(pagesDir);
  if (rootLayout) chain.push({ dir: '', filePath: rootLayout });

  // Check each directory level
  let currentDir = pagesDir;
  let relDir = '';
  for (const part of dirParts) {
    currentDir = path.join(currentDir, part);
    relDir = relDir ? `${relDir}/${part}` : part;
    const layoutFile = findLayoutFile(currentDir);
    if (layoutFile) chain.push({ dir: relDir, filePath: layoutFile });
  }

  return chain;
}

function findLayoutFile(dir: string): string | null {
  for (const ext of ['.ts', '.js']) {
    const p = path.join(dir, `_layout${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Aggressively invalidate a module and all its SSR-imported dependencies.
 * Without this, editing a component imported by a page/layout serves stale SSR.
 */
function invalidateSsrModule(server: ViteDevServer, filePath: string) {
  const visited = new Set<string>();

  function invalidateRecursive(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const mods = server.moduleGraph.getModulesByFile(id);
    if (mods) {
      for (const m of mods) {
        server.moduleGraph.invalidateModule(m);
        (m as any).ssrModule = null;
        (m as any).ssrTransformResult = null;
        // Recurse into SSR-imported modules
        if (m.ssrImportedModules) {
          for (const dep of m.ssrImportedModules) {
            if (dep.file) invalidateRecursive(dep.file);
          }
        }
      }
    }

    const urlMod = server.moduleGraph.getModuleById(id);
    if (urlMod) {
      server.moduleGraph.invalidateModule(urlMod);
      (urlMod as any).ssrModule = null;
      (urlMod as any).ssrTransformResult = null;
    }
  }

  invalidateRecursive(filePath);
}

/**
 * Patch the SSR customElements registry to allow re-registration,
 * and proactively clear all definitions so auto-define guards pass.
 */
function clearSsrCustomElement(g: any) {
  const registry = g.customElements;
  if (!registry) return;

  // Patch define() to allow re-registration and get() to bypass
  // auto-define guards (one-time)
  if (!registry.__nk_patched) {
    registry.__nk_patched = true;
    const origDefine = registry.define.bind(registry);
    registry.define = (name: string, ctor: any) => {
      if (registry.__definitions && registry.__definitions.has(name)) {
        const oldCtor = registry.__definitions.get(name)?.ctor;
        registry.__definitions.delete(name);
        if (oldCtor && registry.__reverseDefinitions) {
          registry.__reverseDefinitions.delete(oldCtor);
        }
      }
      return origDefine(name, ctor);
    };

    // Patch get() so auto-define's `if (!customElements.get('tag'))` guard
    // always passes, allowing define() to re-register the fresh class.
    const origGet = registry.get.bind(registry);
    registry.get = (name: string) => {
      if (registry.__nk_bypass_get) return undefined;
      return origGet(name);
    };
  }
}
