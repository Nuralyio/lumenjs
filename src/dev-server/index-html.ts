import { escapeHtml } from '../shared/utils.js';

export interface IndexHtmlOptions {
  title: string;
  editorMode: boolean;
  ssrContent?: string;
  loaderData?: any;
  layoutsData?: Array<{ loaderPath: string; data: any }>;
  integrations?: string[];
  locale?: string;
  i18nConfig?: { locales: string[]; defaultLocale: string; prefixDefault: boolean };
  translations?: Record<string, string>;
}

/**
 * Generates the index.html shell that loads the LumenJS app.
 * Includes the router, app shell, and optionally the editor bridge.
 */
export function generateIndexHtml(options: IndexHtmlOptions): string {
  const editorScript = options.editorMode
    ? `<script type="module" src="/@lumenjs/editor-bridge"></script>`
    : '';

  const isSSR = !!options.ssrContent;
  const appTag = isSSR
    ? `<nk-app data-nk-ssr><div id="nk-router-outlet">${options.ssrContent}</div></nk-app>`
    : '<nk-app></nk-app>';

  // Build SSR data: if layouts are present, use structured format { page, layouts }
  let loaderDataScript = '';
  if (isSSR && (options.loaderData !== undefined || options.layoutsData)) {
    const ssrData = options.layoutsData
      ? { page: options.loaderData, layouts: options.layoutsData }
      : options.loaderData;
    loaderDataScript = `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(ssrData).replace(/</g, '\\u003c')}</script>`;
  }

  // i18n: inline translations and config for client hydration
  let i18nScript = '';
  if (options.i18nConfig && options.locale && options.translations) {
    const i18nData = {
      config: options.i18nConfig,
      locale: options.locale,
      translations: options.translations,
    };
    i18nScript = `<script type="application/json" id="__nk_i18n__">${JSON.stringify(i18nData).replace(/</g, '\\u003c')}</script>`;
  }

  // i18n module is loaded via imports from router-hydration, no separate script needed

  // Hydrate support is always loaded via the app-shell virtual module (first import)
  // to avoid Lit module duplication from separate script tags.

  const htmlLang = options.locale || 'en';

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
  ${options.integrations?.includes('nuralyui') ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@nuralyui/themes@latest/dist/default.css">' : ''}${options.integrations?.includes('tailwind') ? '\n  <script type="module">import "/styles/tailwind.css";</script>' : ''}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; }
    nk-app { display: block; min-height: 100vh; }
  </style>
</head>
<body>
  ${i18nScript}
  ${loaderDataScript}
  ${appTag}
  <script type="module" src="/@lumenjs/app-shell"></script>
  ${editorScript}
</body>
</html>`;
}
