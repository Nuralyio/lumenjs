import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import type { BuildManifest } from '../shared/types.js';
import { stripOuterLitMarkers, patchLoaderDataSpread } from '../shared/utils.js';
import { installDomShims } from '../shared/dom-shims.js';
import { htmlToMarkdown } from '../shared/html-to-markdown.js';
import type { PageEntry } from './scan.js';

export interface MarkdownOptions {
  serverDir: string;
  clientDir: string;
  pagesDir: string;
  pageEntries: PageEntry[];
  manifest: BuildManifest;
}

/**
 * Generate static .md files for each page by SSR-rendering the component
 * and converting the HTML to markdown. Written to clientDir so the
 * production static file server picks them up (e.g., /docs/routing.md).
 */
export async function generateMarkdownPages(opts: MarkdownOptions): Promise<void> {
  const { serverDir, clientDir, pagesDir, pageEntries, manifest } = opts;

  // Skip if no pages
  if (pageEntries.length === 0) return;

  // Load SSR runtime
  const ssrRuntimePath = pathToFileURL(path.join(serverDir, 'ssr-runtime.js')).href;
  let ssrRuntime: any;
  try {
    ssrRuntime = await import(ssrRuntimePath);
  } catch {
    // No SSR runtime — skip markdown generation
    return;
  }

  const { render, html, unsafeStatic } = ssrRuntime;
  installDomShims();

  let count = 0;

  for (const page of pageEntries) {
    // Skip dynamic routes (e.g., /blog/:slug)
    if (page.routePath.includes(':')) continue;

    // Skip auth-protected pages — SSR-rendering without user context would
    // leak the unauthenticated/redirect view as a public /path.md file.
    if (page.hasAuth) continue;

    const moduleName = `pages/${page.name.replace(/\[(\w+)\]/g, '_$1_')}.js`;
    let modulePath = path.join(serverDir, moduleName);
    if (!fs.existsSync(modulePath)) {
      modulePath = path.join(serverDir, moduleName.replace(/\[/g, '_').replace(/\]/g, '_'));
    }
    if (!fs.existsSync(modulePath)) continue;

    try {
      const mod = await import(pathToFileURL(modulePath).href);

      // Run loader if present
      let loaderData: any = undefined;
      if (mod.loader && typeof mod.loader === 'function') {
        loaderData = await mod.loader({ params: {}, query: {}, url: page.routePath, headers: {} });
        if (loaderData?.__nk_redirect) continue;
      }

      // Get tag name from manifest
      const route = manifest.routes.find(r => r.path === page.routePath);
      const tagName = route?.tagName;
      if (!tagName) continue;

      patchLoaderDataSpread(tagName);

      const tag = unsafeStatic(tagName);
      const template = loaderData !== undefined
        ? html`<${tag} .loaderData=${loaderData}></${tag}>`
        : html`<${tag}></${tag}>`;

      let rendered = '';
      for (const chunk of render(template)) {
        rendered += typeof chunk === 'string' ? chunk : String(chunk);
      }
      rendered = stripOuterLitMarkers(rendered);

      const markdown = htmlToMarkdown(rendered);
      if (!markdown.trim()) continue;

      // Write to clientDir so static serving picks it up
      // /docs/routing → clientDir/docs/routing.md
      const mdPath = page.routePath === '/'
        ? path.join(clientDir, 'index.md')
        : path.join(clientDir, page.routePath + '.md');

      // Skip if user provided their own .md file (copied from public/ during client build)
      if (fs.existsSync(mdPath)) continue;

      const mdDir = path.dirname(mdPath);
      if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });
      fs.writeFileSync(mdPath, markdown);
      count++;
    } catch (err: any) {
      // Skip pages that fail to render
      console.warn(`[LumenJS] Markdown generation skipped for ${page.routePath}: ${err?.message}`);
    }
  }

  if (count > 0) {
    console.log(`[LumenJS] Generated ${count} markdown page(s) for /llms.txt`);
  }
}
