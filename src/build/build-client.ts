import { build as viteBuild, type UserConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';
import { generateIndexHtml } from '../dev-server/index-html.js';

export interface BuildClientOptions {
  projectDir: string;
  clientDir: string;
  title: string;
  integrations: string[];
  prefetchStrategy: 'hover' | 'viewport' | 'none';
  publicDir: string;
  shared: {
    resolve: UserConfig['resolve'];
    esbuild: UserConfig['esbuild'];
    plugins: Plugin[];
  };
}

export async function buildClient(opts: BuildClientOptions): Promise<void> {
  const { projectDir, clientDir, title, integrations, prefetchStrategy, publicDir, shared } = opts;

  console.log('[LumenJS] Building client bundle...');

  // Read optional head.html for blocking scripts (e.g. theme initialization)
  const headHtmlPath = path.join(projectDir, 'head.html');
  const headContent = fs.existsSync(headHtmlPath) ? fs.readFileSync(headHtmlPath, 'utf-8') : undefined;

  // Generate index.html as build entry
  const indexHtml = generateIndexHtml({ title, editorMode: false, integrations, prefetch: prefetchStrategy, headContent });
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
          external: ['mermaid', 'monaco-editor', 'monacopilot', '@lumenjs/db', '@lumenjs/permissions', '@lumenjs/storage'],
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
}
