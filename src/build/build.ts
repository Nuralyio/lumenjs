import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { getSharedViteConfig } from '../dev-server/server.js';
import { readProjectConfig } from '../dev-server/config.js';
import type { BuildManifest } from '../shared/types.js';
import { filePathToTagName, fileGetApiMethods } from '../shared/utils.js';
import { scanPages, scanLayouts, scanApiRoutes, scanMiddleware, getLayoutDirsForPage } from './scan.js';
import { buildClient } from './build-client.js';
import { buildServer } from './build-server.js';
import { prerenderPages } from './build-prerender.js';
import { generateMarkdownPages } from './build-markdown.js';
import { generateLlmsTxt, resolveDynamicEntries } from '../llms/generate.js';
import type { LlmsPage, LlmsApiRoute } from '../llms/generate.js';

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

  // Scan pages, layouts, API routes, and middleware for the manifest
  const pageEntries = scanPages(pagesDir);
  const layoutEntries = scanLayouts(pagesDir);
  const apiEntries = scanApiRoutes(apiDir);
  const middlewareEntries = scanMiddleware(pagesDir);

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
  await buildClient({
    projectDir,
    clientDir,
    title,
    integrations,
    prefetchStrategy,
    publicDir,
    shared,
  });

  // --- Server build ---
  await buildServer({
    projectDir,
    serverDir,
    pageEntries,
    layoutEntries,
    apiEntries,
    middlewareEntries,
    hasAuthConfig,
    authConfigPath,
    shared,
  });

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
        module: `pages/${e.name.replace(/\[(\w+)\]/g, '_$1_')}.js`,
        hasLoader: e.hasLoader,
        hasSubscribe: e.hasSubscribe,
        tagName: filePathToTagName(relPath),
        ...(routeLayouts.length > 0 ? { layouts: routeLayouts } : {}),
        ...(e.hasSocket ? { hasSocket: true } : {}),
        ...(e.hasAuth ? { hasAuth: true } : {}),
        ...(e.hasMeta ? { hasMeta: true } : {}),
        ...(e.hasStandalone ? { hasStandalone: true } : {}),
        ...(e.prerender ? { prerender: true } : {}),
      };
    }),
    apiRoutes: apiEntries.map(e => ({
      path: `/api/${e.routePath}`,
      module: `api/${e.name.replace(/\[(\w+)\]/g, '_$1_')}.js`,
      hasLoader: false,
      hasSubscribe: false,
    })),
    layouts: layoutEntries.map(e => ({
      dir: e.dir,
      module: e.dir ? `layouts/${e.dir}/_layout.js` : 'layouts/_layout.js',
      hasLoader: e.hasLoader,
      hasSubscribe: e.hasSubscribe,
    })),
    ...(middlewareEntries.length > 0 ? {
      middlewares: middlewareEntries.map(e => ({
        dir: e.dir,
        module: e.dir ? `middleware/${e.dir}/_middleware.js` : 'middleware/_middleware.js',
      })),
    } : {}),
    ...(i18nConfig ? { i18n: i18nConfig } : {}),
    ...(hasAuthConfig ? { auth: { configModule: 'auth-config.js' } } : {}),
    prefetch: prefetchStrategy,
  };

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // --- Generate llms.txt ---
  const publicLlms = path.join(publicDir, 'llms.txt');
  if (!fs.existsSync(publicLlms)) {
    const llmsPages: LlmsPage[] = [];
    const pagesForResolver = pageEntries.map(e => ({
      path: e.routePath,
      filePath: e.filePath,
      hasLoader: e.hasLoader,
    }));

    for (const e of pageEntries) {
      const llmsPage: LlmsPage = {
        path: e.routePath,
        hasLoader: e.hasLoader,
        hasSubscribe: e.hasSubscribe,
        ...(e.hasAuth ? { hasAuth: true } : {}),
      };

      if (e.hasLoader && !e.hasAuth) {
        const moduleName = `pages/${e.name.replace(/\[(\w+)\]/g, '_$1_')}.js`;
        let modulePath = path.join(serverDir, moduleName);
        if (!fs.existsSync(modulePath)) {
          modulePath = path.join(serverDir, moduleName.replace(/\[/g, '_').replace(/\]/g, '_'));
        }

        if (fs.existsSync(modulePath)) {
          const isDynamic = e.routePath.includes(':');

          if (isDynamic) {
            const paramMatch = e.routePath.match(/:([^/]+)/);
            const paramName = paramMatch ? paramMatch[1] : '';
            if (paramName) {
              try {
                const loadModule = (filePath: string) => {
                  const entryForFile = pageEntries.find(p => p.filePath === filePath);
                  if (!entryForFile) return import(pathToFileURL(filePath).href);
                  const modName = `pages/${entryForFile.name.replace(/\[(\w+)\]/g, '_$1_')}.js`;
                  let modPath = path.join(serverDir, modName);
                  if (!fs.existsSync(modPath)) {
                    modPath = path.join(serverDir, modName.replace(/\[/g, '_').replace(/\]/g, '_'));
                  }
                  return import(pathToFileURL(modPath).href);
                };
                const entries = await resolveDynamicEntries(
                  { path: e.routePath, paramName },
                  loadModule,
                  pagesForResolver,
                );
                if (entries) {
                  llmsPage.dynamicEntries = entries;
                }
              } catch {
                // Skip dynamic resolution errors
              }
            }
          } else {
            try {
              const mod = await import(pathToFileURL(modulePath).href);
              if (mod?.loader && typeof mod.loader === 'function') {
                const data = await mod.loader({ params: {}, query: {}, url: e.routePath, headers: {} });
                if (data && !data.__nk_redirect) {
                  llmsPage.loaderData = data;
                }
              }
            } catch {
              // Skip loader errors
            }
          }
        }
      }

      llmsPages.push(llmsPage);
    }

    const llmsApiRoutes: LlmsApiRoute[] = apiEntries.map(e => ({
      path: e.routePath,
      methods: fileGetApiMethods(e.filePath),
    })).filter(r => r.methods.length > 0);
    const llmsContent = generateLlmsTxt({
      title,
      pages: llmsPages,
      apiRoutes: llmsApiRoutes,
      integrations,
      i18n: i18nConfig ? { locales: i18nConfig.locales, defaultLocale: i18nConfig.defaultLocale } : undefined,
    });
    fs.writeFileSync(path.join(clientDir, 'llms.txt'), llmsContent);
    console.log('[LumenJS] Generated llms.txt');
  }

  // --- Pre-render phase ---
  await prerenderPages({
    serverDir,
    clientDir,
    pagesDir,
    pageEntries,
    layoutEntries,
    manifest,
  });

  // --- Generate .md files for each page (llms.txt per-page support) ---
  await generateMarkdownPages({
    serverDir,
    clientDir,
    pagesDir,
    pageEntries,
    manifest,
  });

  console.log('[LumenJS] Build complete.');
  console.log(`  Output: ${outDir}`);
  console.log(`  Client assets: ${clientDir}`);
  console.log(`  Server modules: ${serverDir}`);
  console.log(`  Routes: ${pageEntries.length} pages, ${apiEntries.length} API routes, ${layoutEntries.length} layouts`);
}
