export interface IndexHtmlOptions {
  title: string;
  editorMode: boolean;
  ssrContent?: string;
  loaderData?: any;
  integrations?: string[];
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

  const loaderDataScript = isSSR && options.loaderData !== undefined
    ? `<script type="application/json" id="__nk_ssr_data__">${JSON.stringify(options.loaderData).replace(/</g, '\\u003c')}</script>`
    : '';

  const hydrateScript = isSSR
    ? `<script type="module">import '@lit-labs/ssr-client/lit-element-hydrate-support.js';</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@nuralyui/themes@latest/dist/default.css">${options.integrations?.includes('tailwind') ? '\n  <link rel="stylesheet" href="/styles/tailwind.css">' : ''}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; }
    nk-app { display: block; min-height: 100vh; }
  </style>
</head>
<body>
  ${loaderDataScript}
  ${appTag}
  ${hydrateScript}
  <script type="module" src="/@lumenjs/app-shell"></script>
  ${editorScript}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
