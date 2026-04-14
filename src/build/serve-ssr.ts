import http from 'http';
import fs from 'fs';
import path from 'path';
import type { BuildManifest } from '../shared/types.js';
import { stripOuterLitMarkers, dirToLayoutTagName, isRedirectResponse, patchLoaderDataSpread } from '../shared/utils.js';
import { matchRoute } from '../shared/route-matching.js';
import { sendCompressed } from './serve-static.js';
import { logger } from '../shared/logger.js';

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
  // Single route match — used for both page module and layout chain
  const matched = matchRoute(manifest.routes, pathname);

  if (matched && matched.route.hasLoader && matched.route.module) {
    // Rollup sanitizes brackets in filenames: [...path] → _...path_
    let modulePath = path.join(serverDir, matched.route.module);
    if (!fs.existsSync(modulePath)) {
      modulePath = path.join(serverDir, matched.route.module.replace(/\[/g, '_').replace(/\]/g, '_'));
    }
    if (fs.existsSync(modulePath)) {
      try {
        const mod = await import(modulePath);

        // Run loader (inline or co-located _loader.js)
        let loaderData: any = undefined;
        let loaderFn: Function | null = mod.loader && typeof mod.loader === 'function' ? mod.loader : null;
        if (!loaderFn && path.basename(modulePath, '.js') === 'index') {
          const colocated = path.join(path.dirname(modulePath), '_loader.js');
          if (fs.existsSync(colocated)) {
            const loaderMod = await import(colocated);
            if (loaderMod.loader && typeof loaderMod.loader === 'function') loaderFn = loaderMod.loader;
          }
        }
        if (loaderFn) {
          loaderData = await loaderFn({ params: matched.params, query: {}, url: pathname, headers: req.headers, user: (req as any).nkAuth?.user ?? null });
          if (isRedirectResponse(loaderData)) {
            res.writeHead(loaderData.status || 302, { Location: loaderData.location });
            res.end();
            return;
          }
        }

        // Use tag name from route manifest (matches client router)
        const tagName = matched.route.tagName;

        // Run layout loaders
        const layoutDirs = matched.route.layouts || [];
        const layoutsData: Array<{ loaderPath: string; data: any }> = [];
        const layoutModules: Array<{ tagName: string; loaderData: any }> = [];

        for (const dir of layoutDirs) {
          const layout = (manifest.layouts || []).find(l => l.dir === dir);
          if (!layout) continue;

          let layoutLoaderData: any = undefined;

          if (layout.module) {
            const layoutModulePath = path.join(serverDir, layout.module);
            if (fs.existsSync(layoutModulePath)) {
              const layoutMod = await import(layoutModulePath);
              if (layout.hasLoader && layoutMod.loader && typeof layoutMod.loader === 'function') {
                layoutLoaderData = await layoutMod.loader({ params: matched.params, query: {}, url: pathname, headers: req.headers, user: (req as any).nkAuth?.user ?? null });
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

        // Run component loaders
        const componentsData: Array<{ tagName: string; data: any }> = [];
        if (manifest.components) {
          for (const comp of manifest.components) {
            const compModPath = path.join(serverDir, comp.module);
            if (fs.existsSync(compModPath)) {
              try {
                const compMod = await import(compModPath);
                if (compMod.loader && typeof compMod.loader === 'function') {
                  const compData = await compMod.loader({ params: {}, query: {}, url: pathname, headers: req.headers, locale: undefined, user: (req as any).nkAuth?.user ?? null });
                  if (compData && typeof compData === 'object' && !compData.__nk_redirect) {
                    componentsData.push({ tagName: comp.tagName, data: compData });
                  }
                }
              } catch { /* non-critical: component loader failed */ }
            }
          }
        }

        // Patch element classes to spread loaderData into individual properties
        for (const lm of layoutModules) {
          patchLoaderDataSpread(lm.tagName);
        }
        for (const cd of componentsData) {
          patchLoaderDataSpread(cd.tagName);
          // Set data on prototype so SSR render picks it up
          const CompCtor = (globalThis as any).customElements?.get?.(cd.tagName);
          if (CompCtor) {
            CompCtor.prototype.loaderData = cd.data;
          }
        }
        if (tagName) patchLoaderDataSpread(tagName);

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
            const hasStructured = layoutsData.length > 0 || componentsData.length > 0;
            const ssrDataObj = hasStructured
              ? { page: loaderData, layouts: layoutsData.length > 0 ? layoutsData : undefined, components: componentsData.length > 0 ? componentsData : undefined }
              : loaderData;
            const loaderDataScript = ssrDataObj !== undefined
              ? `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(ssrDataObj).replace(/</g, '\\u003c')}</script>`
              : '';

            // Auth: inline user data for client hydration
            const authUser = (req as any).nkAuth?.user ?? null;
            const authScript = authUser
              ? `<script type="application/json" id="__nk_auth__">${JSON.stringify(authUser).replace(/</g, '\\u003c')}</script>`
              : '';

            let html_out = indexHtmlShell;
            html_out = html_out.replace(
              /<nk-app><\/nk-app>/,
              `${authScript}${loaderDataScript}<nk-app data-nk-ssr><div id="nk-router-outlet">${ssrHtml}</div></nk-app>`
            );

            sendCompressed(req, res, 200, 'text/html; charset=utf-8', html_out);
            return;
          } catch (ssrErr) {
            logger.warn('SSR render failed, falling back to CSR', { error: (ssrErr as any)?.message });
          }
        }

        // Fallback: inject loader data without SSR HTML
        if (loaderData !== undefined || layoutsData.length > 0 || componentsData.length > 0) {
          const hasStructuredFb = layoutsData.length > 0 || componentsData.length > 0;
          const ssrDataObj = hasStructuredFb
            ? { page: loaderData, layouts: layoutsData.length > 0 ? layoutsData : undefined, components: componentsData.length > 0 ? componentsData : undefined }
            : loaderData;
          const loaderDataScript = `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(ssrDataObj).replace(/</g, '\\u003c')}</script>`;
          const authUserFb = (req as any).nkAuth?.user ?? null;
          const authScriptFb = authUserFb
            ? `<script type="application/json" id="__nk_auth__">${JSON.stringify(authUserFb).replace(/</g, '\\u003c')}</script>`
            : '';
          let html_out = indexHtmlShell.replace('<nk-app>', `${authScriptFb}${loaderDataScript}<nk-app>`);
          sendCompressed(req, res, 200, 'text/html; charset=utf-8', html_out);
          return;
        }
      } catch (err) {
        logger.error('Page handler error', { error: (err as any)?.message });
      }
    }
  }

  // SPA fallback — serve the built index.html with auth data injected
  const fallbackUser = (req as any).nkAuth?.user ?? null;
  if (fallbackUser) {
    const authTag = `<script type="application/json" id="__nk_auth__">${JSON.stringify(fallbackUser).replace(/</g, '\\u003c')}</script>`;
    const html = indexHtmlShell.replace('<nk-app>', `${authTag}<nk-app>`);
    sendCompressed(req, res, 200, 'text/html; charset=utf-8', html);
  } else {
    sendCompressed(req, res, 200, 'text/html; charset=utf-8', indexHtmlShell);
  }
}
