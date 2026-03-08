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
import { autoImportPlugin } from './plugins/vite-plugin-auto-import.js';
import { litHmrPlugin } from './plugins/vite-plugin-lit-hmr.js';
import { sourceAnnotatorPlugin } from './plugins/vite-plugin-source-annotator.js';
import { virtualModulesPlugin } from './plugins/vite-plugin-virtual-modules.js';

// Re-export for backwards compatibility
export { readProjectConfig, readProjectTitle, getLumenJSNodeModules, getLumenJSDirs } from './config.js';
export type { ProjectConfig } from './config.js';
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
  const { runtimeDir, editorDir } = getLumenJSDirs();

  // Resolve NuralyUI paths for aliases
  const nuralyUIPaths = resolveNuralyUIPaths(projectDir);
  const aliases: Record<string, string> = {};
  if (nuralyUIPaths) {
    Object.assign(aliases, getNuralyUIAliases(nuralyUIPaths.componentsPath, nuralyUIPaths.commonPath));
  }

  const resolve: UserConfig['resolve'] = {
    alias: { ...aliases },
    conditions: isDev ? ['development', 'browser'] : ['browser'],
    dedupe: ['lit', 'lit-html', 'lit-element', '@lit/reactive-element'],
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
    litDedupPlugin(lumenNodeModules, isDev),
    autoImportPlugin(projectDir),
    virtualModulesPlugin(runtimeDir, editorDir),
  ];

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
  const { title, integrations } = config;
  const shared = getSharedViteConfig(projectDir, { integrations });

  const server = await createViteServer({
    root: projectDir,
    publicDir: fs.existsSync(publicDir) ? publicDir : undefined,
    server: {
      port,
      host: true,
      strictPort: false,
      allowedHosts: true,
      cors: true,
      hmr: true,
    },
    resolve: shared.resolve,
    plugins: [
      ...shared.plugins,
      lumenApiRoutesPlugin(apiDir, projectDir),
      litHmrPlugin(projectDir),
      ...(editorMode ? [sourceAnnotatorPlugin(projectDir)] : []),
      {
        name: 'lumenjs-index-html',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && !req.url.startsWith('/@') && !req.url.startsWith('/node_modules') &&
                !req.url.startsWith('/api/') && !req.url.startsWith('/__nk_loader/') &&
                !req.url.includes('.') && req.method === 'GET') {
              const pathname = req.url.split('?')[0];
              const SSR_PLACEHOLDER = '<!--__NK_SSR_CONTENT__-->';
              ssrRenderPage(server, pagesDir, pathname, req.headers as Record<string, string | string[] | undefined>).then(async ssrResult => {
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
                  integrations,
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
                const html = generateIndexHtml({ title, editorMode, integrations });
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
        }
      }
    ],
    esbuild: shared.esbuild,
    optimizeDeps: {
      include: ['lit', 'lit/decorators.js', 'lit/directive.js', 'lit/directive-helpers.js', 'lit/async-directive.js', 'lit-html', 'lit-element', '@lit/reactive-element'],
    },
    ssr: {
      noExternal: true,
      external: ['node-domexception'],
      resolve: {
        conditions: ['node', 'import'],
      },
    },
  });

  return server;
}
