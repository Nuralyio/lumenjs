import fs from 'fs';
import path from 'path';
import { Plugin, ViteDevServer } from 'vite';
import type { I18nConfig } from '../middleware/locale.js';

/**
 * Vite plugin for LumenJS i18n support.
 *
 * - Serves `/__nk_i18n/<locale>.json` with translation files
 * - Provides a virtual module `@lumenjs/i18n` that re-exports the runtime
 * - Watches locale files for HMR
 */
export function i18nPlugin(projectDir: string, config: I18nConfig): Plugin {
  const localesDir = path.join(projectDir, 'locales');

  return {
    name: 'lumenjs-i18n',

    configureServer(server: ViteDevServer) {
      // Serve translation JSON files
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/__nk_i18n/')) return next();

        const match = req.url.match(/^\/__nk_i18n\/([a-z]{2}(?:-[a-zA-Z]+)?)\.json$/);
        if (!match) return next();

        const locale = match[1];
        if (!config.locales.includes(locale)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Unknown locale' }));
          return;
        }

        const filePath = path.join(localesDir, `${locale}.json`);
        if (!fs.existsSync(filePath)) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end('{}');
          return;
        }

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          // Validate JSON
          JSON.parse(content);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(content);
        } catch {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid locale file' }));
        }
      });

      // Watch locale files for changes and send HMR event.
      // Uses fs.watchFile (stat-based polling) instead of inotify/chokidar so
      // it works reliably inside Docker containers where inotify misses changes.
      if (fs.existsSync(localesDir)) {
        for (const locale of config.locales) {
          const filePath = path.join(localesDir, `${locale}.json`);
          if (!fs.existsSync(filePath)) continue;
          fs.watchFile(filePath, { interval: 500 }, (curr, prev) => {
            if (curr.mtimeMs === prev.mtimeMs) return;
            server.ws.send({
              type: 'custom',
              event: 'lumenjs:i18n-update',
              data: { locale },
            });
          });
        }
        server.httpServer?.on('close', () => {
          for (const locale of config.locales) {
            fs.unwatchFile(path.join(localesDir, `${locale}.json`));
          }
        });
      }
    },

    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: `
// i18n HMR: listen on Vite's WebSocket for locale file changes.
// Uses window.__lumenjs_i18n_reload (set by the i18n runtime) to update
// translations in the correct module instance — avoids the duplicate-module
// problem caused by Vite's cache-busting query strings on /@fs/ imports.
import { createHotContext } from '/@vite/client';
const hot = createHotContext('/__nk_i18n_hmr');
hot.on('lumenjs:i18n-update', async ({ locale }) => {
  const reload = window.__lumenjs_i18n_reload;
  if (!reload) return;
  const updated = await reload(locale);
  if (!updated) return;
  function __updateAll(root) {
    for (const el of root.querySelectorAll('*')) {
      if (el.requestUpdate) {
        // Clear Lit's template cache to force a full re-render.
        // Deleting _$litPart$ forces Lit to re-create the template from scratch.
        if (el.renderRoot) {
          if ('_$litPart$' in el.renderRoot) {
            delete el.renderRoot['_$litPart$'];
          } else {
            for (const s of Object.getOwnPropertySymbols(el.renderRoot)) {
              const v = el.renderRoot[s];
              if (v && typeof v === 'object' && '_$committedValue' in v) {
                v._$committedValue = undefined;
                break;
              }
            }
          }
        }
        el.requestUpdate();
      }
      if (el.shadowRoot) __updateAll(el.shadowRoot);
    }
  }
  __updateAll(document);
});
`,
          injectTo: 'body' as const,
        },
      ];
    },
  };
}

/**
 * Load translations for a locale from the project's locales/ directory.
 * Used during SSR to inline translations in the HTML.
 */
export function loadTranslationsFromDisk(projectDir: string, locale: string): Record<string, string> {
  const filePath = path.join(projectDir, 'locales', `${locale}.json`);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}
