import { build as viteBuild } from 'vite';
import path from 'path';
import fs from 'fs';
import { getSharedViteConfig } from '../dev-server/server.js';
import { readProjectConfig } from '../dev-server/config.js';
import { generateIndexHtml } from '../dev-server/index-html.js';
import type { BuildManifest } from '../shared/types.js';
import { filePathToTagName, stripOuterLitMarkers, dirToLayoutTagName, isRedirectResponse, patchLoaderDataSpread } from '../shared/utils.js';
import { installDomShims } from '../shared/dom-shims.js';
import { pathToFileURL } from 'url';
import { scanPages, scanLayouts, scanApiRoutes, getLayoutDirsForPage } from './scan.js';

export interface BuildOptions {
  projectDir: string;
  outDir?: string;
}

export async function buildProject(options: BuildOptions): Promise<void> {
  const { projectDir } = options;
  const outDir = options.outDir || path.join(projectDir, '.lumenjs');
  const clientDir = path.join(outDir, 'client');
  const serverDir = path.join(outDir, 'server');
  const pagesDir = path.join(projectDir, 'pages');
  const apiDir = path.join(projectDir, 'api');
  const publicDir = path.join(projectDir, 'public');

  // Clean output directory
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const { title, integrations, i18n: i18nConfig, prefetch: prefetchStrategy, prerender: globalPrerender } = readProjectConfig(projectDir);
  const shared = getSharedViteConfig(projectDir, { mode: 'production', integrations });

  // Scan pages, layouts, and API routes for the manifest
  const pageEntries = scanPages(pagesDir);
  const layoutEntries = scanLayouts(pagesDir);
  const apiEntries = scanApiRoutes(apiDir);

  // Check for auth config
  const authConfigPath = path.join(projectDir, 'lumenjs.auth.ts');
  const hasAuthConfig = fs.existsSync(authConfigPath);

  // Apply global prerender flag from config
  if (globalPrerender) {
    for (const entry of pageEntries) {
      entry.prerender = true;
    }
  }

  // --- Client build ---
  console.log('[LumenJS] Building client bundle...');

  // Generate index.html as build entry
  const indexHtml = generateIndexHtml({ title, editorMode: false, integrations, prefetch: prefetchStrategy });
  const tempIndexPath = path.join(projectDir, '__nk_build_index.html');
  fs.writeFileSync(tempIndexPath, indexHtml);

  try {
    await viteBuild({
      root: projectDir,
      publicDir: fs.existsSync(publicDir) ? publicDir : undefined,
      resolve: shared.resolve,
      plugins: shared.plugins,
      esbuild: shared.esbuild,
      build: {
        outDir: clientDir,
        emptyOutDir: true,
        rollupOptions: {
          input: tempIndexPath,
        },
      },
      logLevel: 'warn',
    });
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempIndexPath)) {
      fs.unlinkSync(tempIndexPath);
    }
  }

  // Rename the built HTML file from __nk_build_index.html to index.html
  const builtHtmlPath = path.join(clientDir, '__nk_build_index.html');
  const finalHtmlPath = path.join(clientDir, 'index.html');
  if (fs.existsSync(builtHtmlPath)) {
    fs.renameSync(builtHtmlPath, finalHtmlPath);
  }

  // --- Server build ---
  console.log('[LumenJS] Building server bundle...');

  // Collect server entry points (pages with loaders + layouts with loaders + API routes)
  const serverEntries: Record<string, string> = {};

  for (const entry of pageEntries) {
    if (entry.hasLoader || entry.hasSubscribe || entry.prerender) {
      serverEntries[`pages/${entry.name}`] = entry.filePath;
    }
  }

  for (const entry of layoutEntries) {
    if (entry.hasLoader || entry.hasSubscribe) {
      const entryName = entry.dir ? `layouts/${entry.dir}/_layout` : 'layouts/_layout';
      serverEntries[entryName] = entry.filePath;
    }
  }

  for (const entry of apiEntries) {
    serverEntries[`api/${entry.name}`] = entry.filePath;
  }

  if (hasAuthConfig) {
    serverEntries['auth-config'] = authConfigPath;
  }

  // Create SSR runtime entry — bundles @lit-labs/ssr alongside Lit so all
  // server modules share one Lit instance (avoids _$EM mismatches).
  const ssrEntryPath = path.join(projectDir, '__nk_ssr_entry.js');
  const hasPageLoaders = pageEntries.some(e => e.hasLoader);
  const hasLayoutLoaders = layoutEntries.some(e => e.hasLoader);
  const hasPrerenderPages = pageEntries.some(e => e.prerender);
  if (hasPageLoaders || hasLayoutLoaders || hasPrerenderPages) {
    fs.writeFileSync(ssrEntryPath, [
      "import '@lit-labs/ssr/lib/install-global-dom-shim.js';",
      "export { render } from '@lit-labs/ssr';",
      "export { html, unsafeStatic } from 'lit/static-html.js';",
    ].join('\n'));
    serverEntries['ssr-runtime'] = ssrEntryPath;
  }

  try {
    if (Object.keys(serverEntries).length > 0) {
      await viteBuild({
        root: projectDir,
        resolve: shared.resolve,
        plugins: shared.plugins,
        esbuild: shared.esbuild,
        build: {
          outDir: serverDir,
          emptyOutDir: true,
          ssr: true,
          rollupOptions: {
            input: serverEntries,
            output: {
              format: 'esm',
              entryFileNames: '[name].js',
              chunkFileNames: 'assets/[name]-[hash].js',
              manualChunks(id: string) {
                // Force all Lit packages into a single shared chunk so SSR runtime
                // and page modules use the exact same Lit class instances.
                if (id.includes('/node_modules/lit/') ||
                    id.includes('/node_modules/lit-html/') ||
                    id.includes('/node_modules/lit-element/') ||
                    id.includes('/node_modules/@lit/reactive-element/')) {
                  return 'lit-shared';
                }
              },
            },
            external: [
              /^node:/,
              'os', 'fs', 'path', 'url', 'util', 'crypto', 'http', 'https', 'net',
              'stream', 'zlib', 'events', 'buffer', 'querystring', 'child_process',
              'worker_threads', 'cluster', 'dns', 'tls', 'assert', 'constants',
            ],
          },
        },
        logLevel: 'warn',
        ssr: {
          noExternal: true,
        },
      });
    } else {
      fs.mkdirSync(serverDir, { recursive: true });
    }
  } finally {
    if (fs.existsSync(ssrEntryPath)) {
      fs.unlinkSync(ssrEntryPath);
    }
  }

  // --- Copy locales ---
  if (i18nConfig) {
    const localesDir = path.join(projectDir, 'locales');
    const outLocalesDir = path.join(outDir, 'locales');
    if (fs.existsSync(localesDir)) {
      fs.mkdirSync(outLocalesDir, { recursive: true });
      for (const file of fs.readdirSync(localesDir)) {
        if (file.endsWith('.json')) {
          fs.copyFileSync(path.join(localesDir, file), path.join(outLocalesDir, file));
        }
      }
      console.log(`[LumenJS] Copied ${i18nConfig.locales.length} locale(s) to output.`);
    }
  }

  // --- Write manifest ---
  const manifest: BuildManifest = {
    routes: pageEntries.map(e => {
      const routeLayouts = e.hasStandalone ? [] : getLayoutDirsForPage(e.filePath, pagesDir, layoutEntries);
      const relPath = path.relative(pagesDir, e.filePath).replace(/\\/g, '/');
      return {
        path: e.routePath,
        module: (e.hasLoader || e.hasSubscribe || e.prerender) ? `pages/${e.name}.js` : '',
        hasLoader: e.hasLoader,
        hasSubscribe: e.hasSubscribe,
        tagName: filePathToTagName(relPath),
        ...(routeLayouts.length > 0 ? { layouts: routeLayouts } : {}),
        ...(e.hasAuth ? { hasAuth: true } : {}),
        ...(e.hasMeta ? { hasMeta: true } : {}),
        ...(e.hasStandalone ? { hasStandalone: true } : {}),
        ...(e.prerender ? { prerender: true } : {}),
      };
    }),
    apiRoutes: apiEntries.map(e => ({
      path: `/api/${e.routePath}`,
      module: `api/${e.name}.js`,
      hasLoader: false,
      hasSubscribe: false,
    })),
    layouts: layoutEntries.map(e => ({
      dir: e.dir,
      module: (e.hasLoader || e.hasSubscribe) ? (e.dir ? `layouts/${e.dir}/_layout.js` : 'layouts/_layout.js') : '',
      hasLoader: e.hasLoader,
      hasSubscribe: e.hasSubscribe,
    })),
    ...(i18nConfig ? { i18n: i18nConfig } : {}),
    ...(hasAuthConfig ? { auth: { configModule: 'auth-config.js' } } : {}),
    prefetch: prefetchStrategy,
  };

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // --- Pre-render phase ---
  const prerenderPages = pageEntries.filter(e => e.prerender);
  if (prerenderPages.length > 0) {
    console.log(`[LumenJS] Pre-rendering ${prerenderPages.length} page(s)...`);

    // Load SSR runtime (installs global DOM shims)
    const ssrRuntimePath = pathToFileURL(path.join(serverDir, 'ssr-runtime.js')).href;
    const ssrRuntime = await import(ssrRuntimePath);
    const { render, html, unsafeStatic } = ssrRuntime;

    // Install additional DOM shims
    installDomShims();

    // Read the built index.html shell
    const indexHtmlShell = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf-8');

    let prerenderCount = 0;
    for (const page of prerenderPages) {
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

  console.log('[LumenJS] Build complete.');
  console.log(`  Output: ${outDir}`);
  console.log(`  Client assets: ${clientDir}`);
  console.log(`  Server modules: ${serverDir}`);
  console.log(`  Routes: ${pageEntries.length} pages, ${apiEntries.length} API routes, ${layoutEntries.length} layouts`);
}
