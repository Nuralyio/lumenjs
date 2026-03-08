import { build as viteBuild } from 'vite';
import path from 'path';
import fs from 'fs';
import { getSharedViteConfig } from '../dev-server/server.js';
import { readProjectConfig } from '../dev-server/config.js';
import { generateIndexHtml } from '../dev-server/index-html.js';
import type { BuildManifest } from '../shared/types.js';
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

  const { title, integrations } = readProjectConfig(projectDir);
  const shared = getSharedViteConfig(projectDir, { mode: 'production', integrations });

  // Scan pages, layouts, and API routes for the manifest
  const pageEntries = scanPages(pagesDir);
  const layoutEntries = scanLayouts(pagesDir);
  const apiEntries = scanApiRoutes(apiDir);

  // --- Client build ---
  console.log('[LumenJS] Building client bundle...');

  // Generate index.html as build entry
  const indexHtml = generateIndexHtml({ title, editorMode: false, integrations });
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
    if (entry.hasLoader) {
      serverEntries[`pages/${entry.name}`] = entry.filePath;
    }
  }

  for (const entry of layoutEntries) {
    if (entry.hasLoader) {
      const entryName = entry.dir ? `layouts/${entry.dir}/_layout` : 'layouts/_layout';
      serverEntries[entryName] = entry.filePath;
    }
  }

  for (const entry of apiEntries) {
    serverEntries[`api/${entry.name}`] = entry.filePath;
  }

  // Create SSR runtime entry — bundles @lit-labs/ssr alongside Lit so all
  // server modules share one Lit instance (avoids _$EM mismatches).
  const ssrEntryPath = path.join(projectDir, '__nk_ssr_entry.js');
  const hasPageLoaders = pageEntries.some(e => e.hasLoader);
  const hasLayoutLoaders = layoutEntries.some(e => e.hasLoader);
  if (hasPageLoaders || hasLayoutLoaders) {
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

  // --- Write manifest ---
  const manifest: BuildManifest = {
    routes: pageEntries.map(e => {
      const routeLayouts = getLayoutDirsForPage(e.filePath, pagesDir, layoutEntries);
      return {
        path: e.routePath,
        module: e.hasLoader ? `pages/${e.name}.js` : '',
        hasLoader: e.hasLoader,
        ...(routeLayouts.length > 0 ? { layouts: routeLayouts } : {}),
      };
    }),
    apiRoutes: apiEntries.map(e => ({
      path: `/api/${e.routePath}`,
      module: `api/${e.name}.js`,
      hasLoader: false,
    })),
    layouts: layoutEntries.map(e => ({
      dir: e.dir,
      module: e.hasLoader ? (e.dir ? `layouts/${e.dir}/_layout.js` : 'layouts/_layout.js') : '',
      hasLoader: e.hasLoader,
    })),
  };

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log('[LumenJS] Build complete.');
  console.log(`  Output: ${outDir}`);
  console.log(`  Client assets: ${clientDir}`);
  console.log(`  Server modules: ${serverDir}`);
  console.log(`  Routes: ${pageEntries.length} pages, ${apiEntries.length} API routes, ${layoutEntries.length} layouts`);
}
