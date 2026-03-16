import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Plugin, ViteDevServer } from 'vite';
import type { I18nConfig } from '../middleware/locale.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Vite plugin for LumenJS i18n support.
 *
 * - Serves `/__nk_i18n/<locale>.json` with translation files
 * - Provides a virtual module `@lumenjs/i18n` that re-exports the runtime
 * - Watches locale files for HMR
 */
export function i18nPlugin(projectDir: string, config: I18nConfig): Plugin {
  const localesDir = path.join(projectDir, 'locales');
  // Resolve the i18n runtime module path so the HMR script imports the same
  // module instance as page components (which use /@fs/... paths).
  const i18nModulePath = path.resolve(__dirname, '../../runtime/i18n.js').replace(/\\/g, '/');

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

      // Watch locale directory for changes and send HMR event
      if (fs.existsSync(localesDir)) {
        server.watcher.add(localesDir);
        server.watcher.on('change', (file: string) => {
          if (!file.startsWith(localesDir) || !file.endsWith('.json')) return;
          const locale = path.basename(file, '.json');
          server.ws.send({
            type: 'custom',
            event: 'lumenjs:i18n-update',
            data: { locale },
          });
        });
      }
    },

    transformIndexHtml() {
      // Use /@fs/ path so the browser imports the same i18n module instance
      // that page components use (not a duplicate via /@id/@lumenjs/i18n).
      const i18nBrowserPath = `/@fs${i18nModulePath}`;
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: `
// i18n HMR: listen on Vite's WebSocket for locale file changes.
// We import the Vite client module to get access to the HMR socket,
// since inline scripts don't have import.meta.hot.
import { createHotContext } from '/@vite/client';
const hot = createHotContext('/__nk_i18n_hmr');
hot.on('lumenjs:i18n-update', async ({ locale }) => {
  const { getLocale, loadTranslations } = await import('${i18nBrowserPath}');
  if (locale !== getLocale()) return;
  await loadTranslations(locale);
  function __updateAll(root) {
    for (const el of root.querySelectorAll('*')) {
      if (el.requestUpdate) {
        // Clear Lit's template cache to force full re-render
        if (el.renderRoot) {
          const childPart = Object.getOwnPropertySymbols(el.renderRoot)
            .map(s => el.renderRoot[s])
            .find(v => v && typeof v === 'object' && '_$committedValue' in v);
          if (childPart) childPart._$committedValue = undefined;
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
