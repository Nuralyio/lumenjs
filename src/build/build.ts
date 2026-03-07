import { build as viteBuild } from 'vite';
import path from 'path';
import fs from 'fs';
import { getSharedViteConfig, readProjectConfig } from '../dev-server/server.js';
import { generateIndexHtml } from '../dev-server/index-html.js';

export interface BuildOptions {
  projectDir: string;
  outDir?: string;
}

interface ManifestRoute {
  path: string;
  module: string;
  hasLoader: boolean;
}

interface BuildManifest {
  routes: ManifestRoute[];
  apiRoutes: ManifestRoute[];
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

  // Scan pages and API routes for the manifest
  const pageEntries = scanPages(pagesDir);
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

  // Collect server entry points (pages with loaders + API routes)
  const serverEntries: Record<string, string> = {};

  for (const entry of pageEntries) {
    if (entry.hasLoader) {
      serverEntries[`pages/${entry.name}`] = entry.filePath;
    }
  }

  for (const entry of apiEntries) {
    serverEntries[`api/${entry.name}`] = entry.filePath;
  }

  // Create SSR runtime entry — bundles @lit-labs/ssr alongside Lit so all
  // server modules share one Lit instance (avoids _$EM mismatches).
  const ssrEntryPath = path.join(projectDir, '__nk_ssr_entry.js');
  const hasPageLoaders = pageEntries.some(e => e.hasLoader);
  if (hasPageLoaders) {
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
    routes: pageEntries.map(e => ({
      path: e.routePath,
      module: e.hasLoader ? `pages/${e.name}.js` : '',
      hasLoader: e.hasLoader,
    })),
    apiRoutes: apiEntries.map(e => ({
      path: `/api/${e.routePath}`,
      module: `api/${e.name}.js`,
      hasLoader: false,
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
  console.log(`  Routes: ${pageEntries.length} pages, ${apiEntries.length} API routes`);
}

interface PageEntry {
  name: string;
  filePath: string;
  routePath: string;
  hasLoader: boolean;
}

function scanPages(pagesDir: string): PageEntry[] {
  if (!fs.existsSync(pagesDir)) return [];
  const entries: PageEntry[] = [];
  walkDir(pagesDir, '', entries, pagesDir);
  return entries;
}

function walkDir(baseDir: string, relativePath: string, entries: PageEntry[], pagesDir: string) {
  const fullDir = path.join(baseDir, relativePath);
  const dirEntries = fs.readdirSync(fullDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    const entryRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      walkDir(baseDir, entryRelative, entries, pagesDir);
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
      const filePath = path.join(pagesDir, entryRelative);
      const name = entryRelative.replace(/\.(ts|js)$/, '').replace(/\\/g, '/');
      const routePath = filePathToRoute(entryRelative);
      const hasLoader = fileHasLoader(filePath);
      entries.push({ name, filePath, routePath, hasLoader });
    }
  }
}

function filePathToRoute(filePath: string): string {
  let route = filePath
    .replace(/\.(ts|js)$/, '')
    .replace(/\\/g, '/')
    .replace(/\[\.\.\.([^\]]+)\]/g, ':...$1') // [...slug] → :...slug (catch-all)
    .replace(/\[([^\]]+)\]/g, ':$1');

  if (route === 'index' || route.endsWith('/index')) {
    route = route.slice(0, -5).replace(/\/$/, '') || '/';
  }

  return route.startsWith('/') ? route : '/' + route;
}

function fileHasLoader(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return /export\s+(async\s+)?function\s+loader\s*\(/.test(content);
  } catch { return false; }
}

interface ApiEntry {
  name: string;
  filePath: string;
  routePath: string;
}

function scanApiRoutes(apiDir: string): ApiEntry[] {
  if (!fs.existsSync(apiDir)) return [];
  const entries: ApiEntry[] = [];
  walkApiDir(apiDir, '', entries, apiDir);
  return entries;
}

function walkApiDir(baseDir: string, relativePath: string, entries: ApiEntry[], apiDir: string) {
  const fullDir = path.join(baseDir, relativePath);
  const dirEntries = fs.readdirSync(fullDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    const entryRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      walkApiDir(baseDir, entryRelative, entries, apiDir);
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.startsWith('_')) {
      const filePath = path.join(apiDir, entryRelative);
      const name = entryRelative.replace(/\.(ts|js)$/, '').replace(/\\/g, '/');
      const routePath = entryRelative
        .replace(/\.(ts|js)$/, '')
        .replace(/\\/g, '/')
        .replace(/\[([^\]]+)\]/g, ':$1');
      entries.push({ name, filePath, routePath });
    }
  }
}
