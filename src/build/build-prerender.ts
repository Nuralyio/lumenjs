import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import type { BuildManifest } from '../shared/types.js';
import { filePathToTagName, stripOuterLitMarkers, dirToLayoutTagName, isRedirectResponse, patchLoaderDataSpread } from '../shared/utils.js';
import { installDomShims } from '../shared/dom-shims.js';
import type { PageEntry, LayoutEntry } from './scan.js';
import { getLayoutDirsForPage } from './scan.js';

export interface PrerenderOptions {
  serverDir: string;
  clientDir: string;
  pagesDir: string;
  pageEntries: PageEntry[];
  layoutEntries: LayoutEntry[];
  manifest: BuildManifest;
}

export async function prerenderPages(opts: PrerenderOptions): Promise<void> {
  const { serverDir, clientDir, pagesDir, pageEntries, layoutEntries, manifest } = opts;

  const prerenderEntries = pageEntries.filter(e => e.prerender);
  if (prerenderEntries.length === 0) return;

  console.log(`[LumenJS] Pre-rendering ${prerenderEntries.length} page(s)...`);

  // Load SSR runtime (installs global DOM shims)
  const ssrRuntimePath = pathToFileURL(path.join(serverDir, 'ssr-runtime.js')).href;
  const ssrRuntime = await import(ssrRuntimePath);
  const { render, html, unsafeStatic } = ssrRuntime;

  // Install additional DOM shims
  installDomShims();

  // Read the built index.html shell
  const indexHtmlShell = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf-8');

  let prerenderCount = 0;
  for (const page of prerenderEntries) {
    // Resolve server module path (Rollup sanitizes brackets in filenames)
    let modulePath = path.join(serverDir, `pages/${page.name}.js`);
    if (!fs.existsSync(modulePath)) {
      modulePath = path.join(serverDir, `pages/${page.name}.js`.replace(/\[/g, '_').replace(/\]/g, '_'));
    }
    if (!fs.existsSync(modulePath)) {
      console.warn(`  Skipping ${page.routePath}: server module not found`);
      continue;
    }

    const mod = await import(pathToFileURL(modulePath).href);

    // Determine paths to pre-render
    const isDynamic = page.routePath.includes(':');
    let pathsToRender: Array<{ pathname: string; params: Record<string, string> }> = [];

    if (isDynamic) {
      // Dynamic route — call prerenderPaths() for param combinations
      if (typeof mod.prerenderPaths === 'function') {
        const paramsList = await mod.prerenderPaths();
        for (const params of paramsList) {
          // Build pathname from route pattern and params
          let pathname = page.routePath;
          for (const [key, value] of Object.entries(params as Record<string, string>)) {
            // Handle both :param and :...param (catch-all) patterns
            pathname = pathname.replace(`:...${key}`, value).replace(`:${key}`, value);
          }
          pathsToRender.push({ pathname, params: params as Record<string, string> });
        }
      } else {
        console.warn(`  Skipping ${page.routePath}: dynamic route without prerenderPaths()`);
        continue;
      }
    } else {
      // Static route — render once
      pathsToRender.push({ pathname: page.routePath, params: {} });
    }

    for (const { pathname, params } of pathsToRender) {
      // Run loader if present
      let loaderData: any = undefined;
      if (mod.loader && typeof mod.loader === 'function') {
        loaderData = await mod.loader({ params, query: {}, url: pathname, headers: {} });
        if (isRedirectResponse(loaderData)) {
          console.warn(`  Skipping ${pathname}: loader returned redirect`);
          continue;
        }
      }

      // Get tag name
      const relPath = path.relative(pagesDir, page.filePath).replace(/\\/g, '/');
      const tagName = filePathToTagName(relPath);

      // Load and render layout chain
      const routeLayouts = getLayoutDirsForPage(page.filePath, pagesDir, layoutEntries);
      const layoutModules: Array<{ tagName: string; loaderData: any }> = [];
      const layoutsData: Array<{ loaderPath: string; data: any }> = [];

      for (const dir of routeLayouts) {
        const layout = layoutEntries.find(l => l.dir === dir);
        if (!layout) continue;

        let layoutLoaderData: any = undefined;
        if (layout.hasLoader) {
          const manifestLayout = manifest.layouts.find(l => l.dir === dir);
          if (manifestLayout?.module) {
            const layoutModPath = path.join(serverDir, manifestLayout.module);
            if (fs.existsSync(layoutModPath)) {
              const layoutMod = await import(pathToFileURL(layoutModPath).href);
              if (layoutMod.loader && typeof layoutMod.loader === 'function') {
                layoutLoaderData = await layoutMod.loader({ params: {}, query: {}, url: pathname, headers: {} });
                if (isRedirectResponse(layoutLoaderData)) continue;
              }
            }
          }
        }

        const layoutTagName = dirToLayoutTagName(dir);
        layoutModules.push({ tagName: layoutTagName, loaderData: layoutLoaderData });
        layoutsData.push({ loaderPath: dir, data: layoutLoaderData });
      }

      // Patch element classes to spread loaderData
      for (const lm of layoutModules) {
        patchLoaderDataSpread(lm.tagName);
      }
      patchLoaderDataSpread(tagName);

      // SSR render page
      const pageTag = unsafeStatic(tagName);
      const pageTemplate = html`<${pageTag} .loaderData=${loaderData}></${pageTag}>`;
      let ssrHtml = '';
      for (const chunk of render(pageTemplate)) {
        ssrHtml += typeof chunk === 'string' ? chunk : String(chunk);
      }
      ssrHtml = stripOuterLitMarkers(ssrHtml);

      // Wrap in layout chain (inside-out, deepest first)
      for (let i = layoutModules.length - 1; i >= 0; i--) {
        const lTag = unsafeStatic(layoutModules[i].tagName);
        const lData = layoutModules[i].loaderData;
        const lTemplate = html`<${lTag} .loaderData=${lData}></${lTag}>`;
        let lHtml = '';
        for (const chunk of render(lTemplate)) {
          lHtml += typeof chunk === 'string' ? chunk : String(chunk);
        }
        if (i > 0) {
          lHtml = stripOuterLitMarkers(lHtml);
        }
        const closingTag = `</${layoutModules[i].tagName}>`;
        const closingIdx = lHtml.lastIndexOf(closingTag);
        if (closingIdx !== -1) {
          ssrHtml = lHtml.slice(0, closingIdx) + ssrHtml + lHtml.slice(closingIdx);
        } else {
          ssrHtml = lHtml + ssrHtml;
        }
      }

      // Build SSR data script
      const ssrDataObj = layoutsData.length > 0
        ? { page: loaderData, layouts: layoutsData }
        : loaderData;
      const loaderDataScript = ssrDataObj !== undefined
        ? `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(ssrDataObj).replace(/</g, '\\u003c')}</script>`
        : '';
      const hydrateScript = `<script type="module">import '@lit-labs/ssr-client/lit-element-hydrate-support.js';</script>`;

      // Build final HTML from the shell
      let htmlOut = indexHtmlShell;
      htmlOut = htmlOut.replace('<script type="module"', `${hydrateScript}\n  <script type="module"`);
      htmlOut = htmlOut.replace(
        /<nk-app><\/nk-app>/,
        `${loaderDataScript}<nk-app data-nk-ssr><div id="nk-router-outlet">${ssrHtml}</div></nk-app>`
      );

      // Write pre-rendered HTML file
      const outPath = pathname === '/'
        ? path.join(clientDir, 'index.html')
        : path.join(clientDir, pathname, 'index.html');

      // Don't overwrite the root index.html for non-root pages
      if (pathname !== '/') {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
      }
      fs.writeFileSync(outPath, htmlOut);
      prerenderCount++;
      console.log(`  Pre-rendered: ${pathname}`);
    }
  }
  console.log(`[LumenJS] Pre-rendered ${prerenderCount} page(s).`);
}
