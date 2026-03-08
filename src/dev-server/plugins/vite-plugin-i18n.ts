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

      // Watch locale directory for changes and trigger HMR
      if (fs.existsSync(localesDir)) {
        server.watcher.add(localesDir);
      }
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
