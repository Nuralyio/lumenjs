import { build as viteBuild, type UserConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';
import type { PageEntry, LayoutEntry, ApiEntry, MiddlewareEntry } from './scan.js';

export interface BuildServerOptions {
  projectDir: string;
  serverDir: string;
  pageEntries: PageEntry[];
  layoutEntries: LayoutEntry[];
  apiEntries: ApiEntry[];
  middlewareEntries: MiddlewareEntry[];
  hasAuthConfig: boolean;
  authConfigPath: string;
  shared: {
    resolve: UserConfig['resolve'];
    esbuild: UserConfig['esbuild'];
    plugins: Plugin[];
  };
}

export async function buildServer(opts: BuildServerOptions): Promise<void> {
  const { projectDir, serverDir, pageEntries, layoutEntries, apiEntries, middlewareEntries, hasAuthConfig, authConfigPath, shared } = opts;

  console.log('[LumenJS] Building server bundle...');

  // Collect server entry points (pages with loaders + layouts with loaders + API routes)
  const serverEntries: Record<string, string> = {};

  // Include all pages in server build (enables SSR for .md endpoints)
  for (const entry of pageEntries) {
    serverEntries[`pages/${entry.name}`] = entry.filePath;
    // Co-located _loader.ts for folder index pages
    if (path.basename(entry.filePath).replace(/\.(ts|js)$/, '') === 'index') {
      const dir = path.dirname(entry.filePath);
      for (const ext of ['.ts', '.js']) {
        const loaderFile = path.join(dir, `_loader${ext}`);
        if (fs.existsSync(loaderFile)) {
          const entryDir = path.dirname(entry.name);
          serverEntries[`pages/${entryDir}/_loader`] = loaderFile;
          break;
        }
      }
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

  for (const entry of middlewareEntries) {
    const entryName = entry.dir ? `middleware/${entry.dir}/_middleware` : 'middleware/_middleware';
    serverEntries[entryName] = entry.filePath;
  }

  if (hasAuthConfig) {
    serverEntries['auth-config'] = authConfigPath;
  }

  // If data/seed.ts exists, include it in the server bundle for prod seed support
  const seedPath = path.join(projectDir, 'data', 'seed.ts');
  if (fs.existsSync(seedPath)) {
    serverEntries['seed'] = seedPath;
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
              // Native addons — must not be bundled, loaded from node_modules at runtime
              'better-sqlite3',
              // AWS SDK — optional peer dep, keep as runtime import so app can provide it
              '@aws-sdk/client-s3',
              '@aws-sdk/s3-request-presigner',
              /^@aws-sdk\//,
              /^@smithy\//,
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
}
