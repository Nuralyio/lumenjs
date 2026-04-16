import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';
import { scanPages, scanApiRoutes } from '../../build/scan.js';
import { readProjectConfig } from '../config.js';
import { fileGetApiMethods } from '../../shared/utils.js';
import { generateLlmsTxt, resolveDynamicEntries } from '../../llms/generate.js';
import type { LlmsPage, LlmsApiRoute } from '../../llms/generate.js';

export function lumenLlmsPlugin(projectDir: string): Plugin {
  const pagesDir = path.join(projectDir, 'pages');
  const apiDir = path.join(projectDir, 'api');

  return {
    name: 'lumenjs-llms',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url !== '/llms.txt') return next();

        // Check for user override in public/
        const publicOverride = path.join(projectDir, 'public', 'llms.txt');
        if (fs.existsSync(publicOverride)) {
          // Let Vite's static serving handle it
          return next();
        }

        try {
          const config = readProjectConfig(projectDir);
          const pages = scanPages(pagesDir);
          const apiEntries = scanApiRoutes(apiDir);

          // Build API routes with methods
          const apiRoutes: LlmsApiRoute[] = apiEntries.map(entry => ({
            path: entry.routePath,
            methods: fileGetApiMethods(entry.filePath),
          })).filter(r => r.methods.length > 0);

          // Build page data with loader resolution
          const llmsPages: LlmsPage[] = [];

          for (const page of pages) {
            const llmsPage: LlmsPage = {
              path: page.routePath,
              hasLoader: page.hasLoader,
              hasSubscribe: page.hasSubscribe,
              ...(page.hasAuth ? { hasAuth: true } : {}),
            };

            if (page.hasLoader) {
              const isDynamic = page.routePath.includes(':');

              if (isDynamic) {
                // Extract param name from route like /blog/:slug
                const paramMatch = page.routePath.match(/:([^/]+)/);
                const paramName = paramMatch ? paramMatch[1] : '';

                if (paramName) {
                  const entries = await resolveDynamicEntries(
                    { path: page.routePath, paramName },
                    (filePath) => server.ssrLoadModule(filePath),
                    pages.map(p => ({ path: p.routePath, filePath: p.filePath, hasLoader: p.hasLoader })),
                  );
                  if (entries) {
                    llmsPage.dynamicEntries = entries;
                  }
                }
              } else {
                // Static page — call loader directly
                try {
                  const mod = await server.ssrLoadModule(page.filePath);
                  if (mod?.loader) {
                    const data = await mod.loader({ params: {}, query: {}, url: page.routePath, headers: {} });
                    if (data && !data.__nk_redirect) {
                      llmsPage.loaderData = data;
                    }
                  }
                } catch {
                  // Skip loader errors
                }
              }
            }

            llmsPages.push(llmsPage);
          }

          const content = generateLlmsTxt({
            title: config.title,
            pages: llmsPages,
            apiRoutes,
            integrations: config.integrations,
            i18n: config.i18n ? { locales: config.i18n.locales, defaultLocale: config.i18n.defaultLocale } : undefined,
            db: config.db,
            baseUrl: '',
          });

          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.statusCode = 200;
          res.end(content);
        } catch (err) {
          console.error('[LumenJS] Error generating llms.txt:', err);
          res.statusCode = 500;
          res.end('Error generating llms.txt');
        }
      });
    },
  };
}
