import { createServer as createViteServer, ViteDevServer, UserConfig, Plugin } from 'vite';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { lumenRoutesPlugin } from './plugins/vite-plugin-routes.js';
import { lumenApiRoutesPlugin } from './plugins/vite-plugin-api-routes.js';
import { lumenLoadersPlugin } from './plugins/vite-plugin-loaders.js';
import { generateIndexHtml } from './index-html.js';
import { ssrRenderPage } from './ssr-render.js';
import { readProjectConfig, getLumenJSNodeModules, getLumenJSDirs } from './config.js';
import { getNuralyUIAliases, resolveNuralyUIPaths } from './nuralyui-aliases.js';
import { litDedupPlugin } from './plugins/vite-plugin-lit-dedup.js';
import { autoDefinePlugin } from './plugins/vite-plugin-auto-define.js';
import { autoImportPlugin } from './plugins/vite-plugin-auto-import.js';
import { litHmrPlugin } from './plugins/vite-plugin-lit-hmr.js';
import { sourceAnnotatorPlugin } from './plugins/vite-plugin-source-annotator.js';
import { editorApiPlugin } from './plugins/vite-plugin-editor-api.js';
import { virtualModulesPlugin } from './plugins/vite-plugin-virtual-modules.js';
import { i18nPlugin, loadTranslationsFromDisk } from './plugins/vite-plugin-i18n.js';
import { authPlugin } from './plugins/vite-plugin-auth.js';
import { communicationPlugin } from './plugins/vite-plugin-communication.js';
import { lumenStoragePlugin } from './plugins/vite-plugin-storage.js';
import { lumenSocketIOPlugin } from './plugins/vite-plugin-socketio.js';
import { resolveLocale } from './middleware/locale.js';
import { setProjectDir } from '../db/context.js';
import { scanMiddleware, getMiddlewareDirsForPathname } from '../build/scan.js';
import { runMiddlewareChain, extractMiddleware, ConnectMiddleware } from '../shared/middleware-runner.js';

// Re-export for backwards compatibility
export { readProjectConfig, readProjectTitle, getLumenJSNodeModules, getLumenJSDirs } from './config.js';
export type { ProjectConfig, I18nConfig } from './config.js';
export { getNuralyUIAliases, resolveNuralyUIPaths } from './nuralyui-aliases.js';

export interface DevServerOptions {
  projectDir: string;
  port: number;
  editorMode?: boolean;
  base?: string;
}

/**
 * Returns shared Vite config used by both dev and production builds.
 * Includes NuralyUI aliases, lit dedup, loaders strip, auto-import, and virtual modules.
 */
export function getSharedViteConfig(projectDir: string, options?: { mode?: 'development' | 'production'; integrations?: string[] }): {
  resolve: UserConfig['resolve'];
  esbuild: UserConfig['esbuild'];
  plugins: Plugin[];
} {
  const mode = options?.mode || 'development';
  const isDev = mode === 'development';
  const pagesDir = path.join(projectDir, 'pages');
  const lumenNodeModules = getLumenJSNodeModules();
  const { distDir, runtimeDir, editorDir } = getLumenJSDirs();

  // Resolve NuralyUI paths for aliases (only when nuralyui integration is enabled)
  const aliases: Record<string, string> = {};
  if (options?.integrations?.includes('nuralyui')) {
    const nuralyUIPaths = resolveNuralyUIPaths(projectDir);
    if (nuralyUIPaths) {
      Object.assign(aliases, getNuralyUIAliases(nuralyUIPaths.componentsPath, nuralyUIPaths.commonPath));
      // Add root aliases for theme CSS imports
      const nuralyUIRoot = path.resolve(nuralyUIPaths.componentsPath, '..');
      aliases['@nuralyui-theme'] = path.join(nuralyUIRoot, 'shared/themes');
      aliases['@nuralyui-common'] = nuralyUIPaths.commonPath;
    }
  }

  const resolve: UserConfig['resolve'] = {
    alias: {
      ...aliases,
      '@lumenjs/i18n': path.join(runtimeDir, 'i18n.js'),
      '@lumenjs/auth': path.join(runtimeDir, 'auth.js'),
      '@nuraly/lumenjs-auth': path.join(runtimeDir, 'auth.js'),
      '@lumenjs/communication': path.join(runtimeDir, 'communication.js'),
      '@lumenjs/webrtc': path.join(runtimeDir, 'webrtc.js'),
      '@lumenjs/db': path.join(distDir, 'db', 'client.js'),
      '@lumenjs/permissions': path.join(distDir, 'permissions', 'index.js'),
      '@lumenjs/storage': path.join(distDir, 'storage', 'index.js'),
      '@nuraly/lumenjs': path.resolve(distDir, '..'),
    },
    conditions: isDev ? ['development', 'browser'] : ['browser'],
    // Note: resolve.dedupe is NOT used — it resolves via Node's algorithm
    // which ignores Vite's resolve.conditions, picking the `default` export
    // (prod proxy) instead of `development`. The litDedupPlugin handles
    // single-copy resolution with correct conditions instead.
  };

  const esbuild: UserConfig['esbuild'] = {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      }
    }
  };

  const plugins: Plugin[] = [
    lumenRoutesPlugin(pagesDir),
    lumenLoadersPlugin(pagesDir),
    autoDefinePlugin(pagesDir),
    litDedupPlugin(lumenNodeModules, isDev),
    virtualModulesPlugin(runtimeDir, editorDir),
  ];

  // Conditionally add NuralyUI auto-import plugin
  if (options?.integrations?.includes('nuralyui')) {
    plugins.push(autoImportPlugin(projectDir));
  }

  // Conditionally add Tailwind plugin from the project's node_modules
  if (options?.integrations?.includes('tailwind')) {
    try {
      const projectRequire = createRequire(pathToFileURL(path.join(projectDir, 'package.json')).href);
      const tailwindMod = projectRequire('@tailwindcss/vite');
      const tailwindPlugin = tailwindMod.default || tailwindMod;
      plugins.unshift(tailwindPlugin());
    } catch {
      console.warn('[LumenJS] Tailwind integration enabled but @tailwindcss/vite not found. Run: lumenjs add tailwind');
    }
  }

  return { resolve, esbuild, plugins };
}

export async function createDevServer(options: DevServerOptions): Promise<ViteDevServer> {
  const { projectDir, port, editorMode = false, base = '/' } = options;
  const pagesDir = path.join(projectDir, 'pages');
  const apiDir = path.join(projectDir, 'api');
  const publicDir = path.join(projectDir, 'public');

  const config = readProjectConfig(projectDir);
  const { title, integrations, i18n: i18nConfig, prefetch: prefetchStrategy } = config;

  // Read optional head.html for blocking scripts (e.g. theme initialization)
  const headHtmlPath = path.join(projectDir, 'head.html');
  const headContent = fs.existsSync(headHtmlPath) ? fs.readFileSync(headHtmlPath, 'utf-8') : undefined;
  // Set project dir for DB context (used by loaders, API routes, plugins)
  setProjectDir(projectDir);
  process.env.LUMENJS_PROJECT_DIR = projectDir;

  const shared = getSharedViteConfig(projectDir, { integrations });

  // Load user-defined Vite plugins from lumenjs.plugins.js (if present).
  // This allows apps to add custom Vite plugins (e.g. proxy middleware)
  // that run at the raw Connect level, before LumenJS's own middleware.
  // Dev-only: Vite plugins don't run in `lumenjs serve`. For global Connect
  // middleware that works in both dev and prod, use `lumenjs.server.js` instead.
  let userPlugins: Plugin[] = [];
  const pluginsPath = path.join(projectDir, 'lumenjs.plugins.js');
  if (fs.existsSync(pluginsPath)) {
    try {
      // Use a temporary Vite server to load the TS file via ssrLoadModule
      // would be circular, so we import it directly via dynamic import
      // after Vite transforms it. Instead, read and eval the JS-compatible parts.
      // Simplest: the file exports an array of plugin objects.
      const pluginsMod = await import(pathToFileURL(pluginsPath).href);
      const exported = pluginsMod.default || pluginsMod.plugins || pluginsMod;
      if (Array.isArray(exported)) userPlugins = exported;
    } catch (err) {
      console.warn(`[LumenJS] Failed to load lumenjs.plugins.js:`, (err as any)?.message);
    }
  }

  // Load global user middleware from lumenjs.server.js — shared dev/prod convention.
  // In dev, we use ssrLoadModule on every request (like _middleware.ts) so edits to the
  // file are picked up immediately via HMR without a full server restart.
  const serverJsCandidates = ['lumenjs.server.js', 'lumenjs.server.mjs'];
  const serverJsPath = serverJsCandidates
    .map(name => path.join(projectDir, name))
    .find(fp => fs.existsSync(fp));
  const userServerMiddlewarePlugin: Plugin | null = serverJsPath ? {
    name: 'lumenjs-user-server-middleware',
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        try {
          const mod = await server.ssrLoadModule(serverJsPath);
          const middlewares = extractMiddleware(mod);
          if (middlewares.length === 0) return next();
          runMiddlewareChain(middlewares, req, res, next);
        } catch (err) {
          console.warn(`[LumenJS] Failed to load lumenjs.server.js:`, (err as any)?.message);
          next();
        }
      });
    },
  } : null;

  // Build auth plugins up front so we can slot `pre` before `lumenjs-user-middleware`
  // and `post` (the /__nk_auth/* route handler) after it. This matches the prod
  // middleware order in `build/serve.ts:218-253` so gates like invite-only signup
  // run in dev just like they do in prod.
  const authPlugins = integrations.includes('auth') ? authPlugin(projectDir) : null;

  const server = await createViteServer({
    root: projectDir,
    base,
    publicDir: fs.existsSync(publicDir) ? publicDir : undefined,
    server: {
      port,
      host: true,
      strictPort: false,
      allowedHosts: true,
      cors: true,
      hmr: process.env.HMR_CLIENT_PORT ? {
        clientPort: parseInt(process.env.HMR_CLIENT_PORT),
        port: parseInt(process.env.HMR_CLIENT_PORT),
        ...(process.env.HMR_PROTOCOL ? { protocol: process.env.HMR_PROTOCOL } : {}),
        ...(process.env.HMR_HOST ? { host: process.env.HMR_HOST } : {}),
      } : true,
      fs: {
        allow: [projectDir, getLumenJSNodeModules(), path.resolve(getLumenJSNodeModules(), '..')],
      },
    },
    resolve: shared.resolve,
    // 'custom' prevents Vite from adding SPA fallback and indexHtml middleware,
    // which would interfere with LumenJS's own HTML handler (especially when base != '/')
    appType: 'custom',
    plugins: [
      ...userPlugins,
      ...(userServerMiddlewarePlugin ? [userServerMiddlewarePlugin] : []),
      ...(authPlugins ? [authPlugins.pre] : []),
      {
        // User middleware must register as a pre-hook BEFORE the loaders plugin so that
        // /__nk_loader/ and /__nk_subscribe/ requests go through user middleware first.
        // This prevents bypassing access gates by requesting loader data directly.
        name: 'lumenjs-user-middleware',
        config(config: any) {
          const entries = scanMiddleware(pagesDir);
          if (entries.length === 0) return;
          const npmDeps = new Set<string>();
          for (const entry of entries) {
            try {
              const content = fs.readFileSync(entry.filePath, 'utf-8');
              const importMatches = content.matchAll(/(?:import|require)\s*(?:\(?\s*['"]([^./][^'"]*)['"]\s*\)?|.*from\s*['"]([^./][^'"]*)['"]\s*)/g);
              for (const m of importMatches) {
                const pkg = m[1] || m[2];
                if (pkg) {
                  const pkgName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
                  npmDeps.add(pkgName);
                }
              }
            } catch {}
          }
          if (npmDeps.size > 0) {
            const existing = (config.ssr as any)?.external || [];
            return { ssr: { external: [...existing, ...npmDeps] } };
          }
        },
        configureServer(server: ViteDevServer) {
          server.middlewares.use(async (req: any, res: any, next: any) => {
            const pathname = (req.url || '/').split('?')[0];
            if (pathname.startsWith('/@') || pathname.startsWith('/node_modules') || pathname.includes('.')) {
              return next();
            }

            // Map /__nk_loader/ and /__nk_subscribe/ paths back to page paths for middleware matching
            let middlewarePath = pathname;
            if (pathname.startsWith('/__nk_loader/')) {
              middlewarePath = '/' + pathname.slice('/__nk_loader/'.length);
            } else if (pathname.startsWith('/__nk_subscribe/')) {
              middlewarePath = '/' + pathname.slice('/__nk_subscribe/'.length);
            }

            // Resolve locale once, early — before user middleware runs — so
            // middleware can read `req.locale` / `req.localeStrippedPath` and
            // make i18n-aware routing decisions (e.g. redirect unauthenticated
            // users to `/fr/login`). The index-html plugin reuses these values
            // so we don't re-negotiate downstream.
            if (i18nConfig) {
              const localeResult = resolveLocale(middlewarePath, i18nConfig, req.headers as Record<string, string | string[] | undefined>);
              req.locale = localeResult.locale;
              req.localeStrippedPath = localeResult.pathname;
              middlewarePath = localeResult.pathname;
            }

            const middlewareEntries = scanMiddleware(pagesDir);
            if (middlewareEntries.length === 0) return next();

            const matchingDirs = getMiddlewareDirsForPathname(middlewarePath, middlewareEntries);
            if (matchingDirs.length === 0) return next();

            const allMw: ConnectMiddleware[] = [];
            for (const entry of matchingDirs) {
              try {
                const mod = await server.ssrLoadModule(entry.filePath);
                allMw.push(...extractMiddleware(mod));
              } catch (err) {
                console.error(`[LumenJS] Failed to load _middleware.ts (${entry.dir || 'root'}):`, err);
              }
            }

            if (allMw.length === 0) return next();
            runMiddlewareChain(allMw, req, res, next);
          });
        }
      },
      // Auth /__nk_auth/* route handler — registered AFTER user middleware so
      // gates like invite-only signup can intercept before the handler responds.
      ...(authPlugins ? [authPlugins.post] : []),
      ...shared.plugins,
      ...(integrations.includes('communication') ? [communicationPlugin(projectDir)] : []),
      lumenStoragePlugin(projectDir),
      lumenApiRoutesPlugin(apiDir, projectDir),
      litHmrPlugin(projectDir),
      ...(i18nConfig ? [i18nPlugin(projectDir, i18nConfig)] : []),
      ...(editorMode ? [sourceAnnotatorPlugin(projectDir), editorApiPlugin(projectDir)] : []),
      lumenSocketIOPlugin(pagesDir),
      ...(base !== '/' ? [{
        // Fix HMR fetch URLs when Vite runs behind a base path.
        // Vite's import analysis injects createHotContext() with the full filesystem
        // path (e.g. /data/user-apps/.../bb2/pages/index.ts) instead of root-relative.
        // When @vite/client fetches the updated module it builds the URL as
        //   base + filesystemPath.slice(1) → /__app_dev/{id}/data/.../pages/index.ts
        // which 404s because transformMiddleware resolves relative to root, doubling
        // the path. This pre-hook middleware strips the projectDir prefix so
        // baseMiddleware sees the correct root-relative path.
        name: 'lumenjs-hmr-path-fix',
        configureServer(server: ViteDevServer) {
          const projSlash = projectDir.replace(/\\/g, '/');
          server.middlewares.use((req: any, _res: any, next: any) => {
            if (req.url) {
              const prefix = base + projSlash.slice(1) + '/';
              if (req.url.startsWith(prefix)) {
                req.url = base + req.url.slice(prefix.length);
              }
            }
            next();
          });
        },
      } as Plugin] : []),
      {
        // Clear SSR module cache on file changes so the next SSR request uses fresh code.
        // Without this, HMR updates the client but SSR keeps serving stale modules.
        name: 'lumenjs-ssr-invalidate-on-change',
        handleHotUpdate({ file, server }) {
          const mods = server.moduleGraph.getModulesByFile(file);
          if (mods) {
            for (const m of mods) {
              (m as any).ssrModule = null;
              (m as any).ssrTransformResult = null;
            }
          }
        },
      },
      {
        name: 'lumenjs-index-html',
        configureServer(server) {
          return () => {
            server.middlewares.use((req, res, next) => {
            // Guard against malformed percent-encoded URLs that crash Vite's transformIndexHtml
            if (req.url) {
              try {
                decodeURIComponent(req.url);
              } catch {
                res.statusCode = 400;
                res.end('Bad Request');
                return;
              }
            }

            if (req.url && !req.url.startsWith('/@') && !req.url.startsWith('/node_modules') &&
                !req.url.startsWith('/api/') && !req.url.startsWith('/__nk_loader/') &&
                !req.url.startsWith('/__nk_i18n/') &&
                !req.url.includes('.') && req.method === 'GET') {
              let pathname = req.url.split('?')[0];

              // Resolve locale from URL/cookie/header.
              // Reuse the locale already resolved by `lumenjs-user-middleware`
              // so we don't double-negotiate and stay consistent with what user
              // middleware saw on `req.locale` / `req.localeStrippedPath`.
              let locale: string | undefined;
              let translations: Record<string, string> | undefined;
              if (i18nConfig) {
                const existingLocale = (req as any).locale as string | undefined;
                const existingStripped = (req as any).localeStrippedPath as string | undefined;
                if (existingLocale && existingStripped) {
                  locale = existingLocale;
                  pathname = existingStripped;
                } else {
                  const localeResult = resolveLocale(pathname, i18nConfig, req.headers as Record<string, string | string[] | undefined>);
                  locale = localeResult.locale;
                  pathname = localeResult.pathname;
                }
                translations = loadTranslationsFromDisk(projectDir, locale);
              }

              const SSR_PLACEHOLDER = '<!--__NK_SSR_CONTENT__-->';
              ssrRenderPage(server, pagesDir, pathname, req.headers as Record<string, string | string[] | undefined>, locale, (req as any).nkAuth?.user ?? undefined).then(async ssrResult => {
                if (ssrResult?.redirect) {
                  res.writeHead(ssrResult.redirect.status, { Location: ssrResult.redirect.location });
                  res.end();
                  return;
                }
                const shellHtml = generateIndexHtml({
                  title,
                  editorMode,
                  ssrContent: ssrResult ? SSR_PLACEHOLDER : undefined,
                  loaderData: ssrResult?.loaderData,
                  layoutsData: ssrResult?.layoutsData,
                  componentsData: ssrResult?.componentsData,
                  integrations,
                  locale,
                  i18nConfig: i18nConfig || undefined,
                  translations,
                  prefetch: prefetchStrategy,
                  authUser: ssrResult?.authUser ?? (req as any).nkAuth?.user ?? undefined,
                  headContent,
                  base,
                });
                const transformed = await server.transformIndexHtml(req.url!, shellHtml);
                const finalHtml = ssrResult
                  ? transformed.replace(SSR_PLACEHOLDER, ssrResult.html)
                  : transformed;
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Cache-Control', 'no-store');
                res.end(finalHtml);
              }).catch(err => {
                console.error('[LumenJS] SSR/HTML generation error:', err);
                const html = generateIndexHtml({ title, editorMode, integrations, locale, i18nConfig: i18nConfig || undefined, translations, prefetch: prefetchStrategy, headContent, base, authUser: (req as any).nkAuth?.user ?? undefined });
                server.transformIndexHtml(req.url!, html).then(transformed => {
                  res.setHeader('Content-Type', 'text/html');
                  res.setHeader('Cache-Control', 'no-store');
                  res.end(transformed);
                }).catch(next);
              });
              return;
            }
            next();
          });
          };
        }
      }
    ],
    esbuild: shared.esbuild,
    optimizeDeps: {
      exclude: [
        '@lumenjs/i18n',
        '@nuraly/lumenjs-auth',
        // Lit packages must NOT be pre-bundled — pre-bundling creates separate
        // module entries (/.vite/deps/) alongside raw /@fs/ files, causing
        // multiple lit-html instances. Instead, resolve.dedupe forces all lit
        // imports to a single copy. The project's lit version MUST match
        // lumenjs's lit version for dedupe to work.
        'lit', 'lit-html', 'lit-element', '@lit/reactive-element',
        '@lit-labs/ssr-client',
      ],
    },
    ssr: {
      noExternal: true,
      external: ['node-domexception', 'socket.io-client', 'xmlhttprequest-ssl', 'engine.io-client', 'better-sqlite3', '@lumenjs/db', '@lumenjs/permissions', 'amqplib'],
      resolve: {
        conditions: ['node', 'import'],
      },
    },
  });

  return server;
}
