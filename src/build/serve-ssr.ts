import http from 'http';
import fs from 'fs';
import path from 'path';
import type { BuildManifest } from '../shared/types.js';
import { stripOuterLitMarkers, dirToLayoutTagName, isRedirectResponse } from '../shared/utils.js';
import { matchRoute } from '../shared/route-matching.js';
import { sendCompressed } from './serve-static.js';

export async function handlePageRoute(
  manifest: BuildManifest,
  serverDir: string,
  pagesDir: string,
  pathname: string,
  queryString: string | undefined,
  indexHtmlShell: string,
  title: string,
  ssrRuntime: { render: any; html: any; unsafeStatic: any } | null,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Find matching route (any route, not just those with loaders)
  const allMatched = matchRoute(manifest.routes, pathname);

  // Try SSR for routes with loaders
  const matched = matchRoute(manifest.routes.filter(r => r.hasLoader), pathname);

  if (matched && matched.route.module) {
    const modulePath = path.join(serverDir, matched.route.module);
    if (fs.existsSync(modulePath)) {
      try {
        const mod = await import(modulePath);

        // Run loader
        let loaderData: any = undefined;
        if (mod.loader && typeof mod.loader === 'function') {
          loaderData = await mod.loader({ params: matched.params, query: {}, url: pathname, headers: req.headers });
          if (isRedirectResponse(loaderData)) {
            res.writeHead(loaderData.status || 302, { Location: loaderData.location });
            res.end();
            return;
          }
        }

        // Use tag name from route manifest (matches client router)
        const tagName = matched.route.tagName;

        // Run layout loaders
        const layoutDirs = (allMatched || matched).route.layouts || [];
        const layoutsData: Array<{ loaderPath: string; data: any }> = [];
        const layoutModules: Array<{ tagName: string; loaderData: any }> = [];

        for (const dir of layoutDirs) {
          const layout = (manifest.layouts || []).find(l => l.dir === dir);
          if (!layout) continue;

          let layoutLoaderData: any = undefined;

          if (layout.hasLoader && layout.module) {
            const layoutModulePath = path.join(serverDir, layout.module);
            if (fs.existsSync(layoutModulePath)) {
              const layoutMod = await import(layoutModulePath);
              if (layoutMod.loader && typeof layoutMod.loader === 'function') {
                layoutLoaderData = await layoutMod.loader({ params: {}, query: {}, url: pathname, headers: req.headers });
                if (isRedirectResponse(layoutLoaderData)) {
                  res.writeHead(layoutLoaderData.status || 302, { Location: layoutLoaderData.location });
                  res.end();
                  return;
                }
              }
            }
          }

          const layoutTagName = dirToLayoutTagName(dir);
          layoutsData.push({ loaderPath: dir, data: layoutLoaderData });
          layoutModules.push({ tagName: layoutTagName, loaderData: layoutLoaderData });
        }

        if (tagName && ssrRuntime) {
          // SSR render with the bundled @lit-labs/ssr runtime
          try {
            const { render, html, unsafeStatic } = ssrRuntime;

            const pageTag = unsafeStatic(tagName);
            const pageTemplate = html`<${pageTag} .loaderData=${loaderData}></${pageTag}>`;
            let ssrHtml = '';
            for (const chunk of render(pageTemplate)) {
              ssrHtml += typeof chunk === 'string' ? chunk : String(chunk);
            }
            ssrHtml = stripOuterLitMarkers(ssrHtml);

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

            let html_out = indexHtmlShell;
            html_out = html_out.replace(
              /<nk-app><\/nk-app>/,
              `${loaderDataScript}<nk-app data-nk-ssr><div id="nk-router-outlet">${ssrHtml}</div></nk-app>${hydrateScript}`
            );

            sendCompressed(req, res, 200, 'text/html; charset=utf-8', html_out);
            return;
          } catch (ssrErr) {
            console.error('[LumenJS] SSR render failed, falling back to CSR:', ssrErr);
          }
        }

        // Fallback: inject loader data without SSR HTML
        if (loaderData !== undefined || layoutsData.length > 0) {
          const ssrDataObj = layoutsData.length > 0
            ? { page: loaderData, layouts: layoutsData }
            : loaderData;
          const loaderDataScript = `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(ssrDataObj).replace(/</g, '\\u003c')}</script>`;
          let html_out = indexHtmlShell.replace('<nk-app>', `${loaderDataScript}<nk-app>`);
          sendCompressed(req, res, 200, 'text/html; charset=utf-8', html_out);
          return;
        }
      } catch (err) {
        console.error('[LumenJS] Page handler error:', err);
      }
    }
  }

  // SPA fallback — serve the built index.html
  sendCompressed(req, res, 200, 'text/html; charset=utf-8', indexHtmlShell);
}
