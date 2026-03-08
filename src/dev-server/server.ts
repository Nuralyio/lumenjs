import { createServer as createViteServer, ViteDevServer, UserConfig, Plugin } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { lumenRoutesPlugin } from './vite-plugin-routes.js';
import { lumenApiRoutesPlugin } from './vite-plugin-api-routes.js';
import { lumenLoadersPlugin } from './vite-plugin-loaders.js';
import { generateIndexHtml } from './index-html.js';
import { ssrRenderPage } from './ssr-render.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DevServerOptions {
  projectDir: string;
  port: number;
  editorMode?: boolean;
  base?: string;
}

/**
 * NuralyUI component alias map — mirrors the studio astro.config.mjs aliases.
 * Points to the component source directories within the studio service.
 */
export function getNuralyUIAliases(nuralyUIPath: string, nuralyCommonPath: string): Record<string, string> {
  return {
    '@nuralyui/alert': path.join(nuralyUIPath, 'alert'),
    '@nuralyui/badge': path.join(nuralyUIPath, 'badge'),
    '@nuralyui/breadcrumb': path.join(nuralyUIPath, 'breadcrumb'),
    '@nuralyui/button': path.join(nuralyUIPath, 'button'),
    '@nuralyui/canvas': path.join(nuralyUIPath, 'canvas'),
    '@nuralyui/card': path.join(nuralyUIPath, 'card'),
    '@nuralyui/chatbot': path.join(nuralyUIPath, 'chatbot'),
    '@nuralyui/checkbox': path.join(nuralyUIPath, 'checkbox'),
    '@nuralyui/collapse': path.join(nuralyUIPath, 'collapse'),
    '@nuralyui/color-picker': path.join(nuralyUIPath, 'colorpicker'),
    '@nuralyui/datepicker': path.join(nuralyUIPath, 'datepicker'),
    '@nuralyui/divider': path.join(nuralyUIPath, 'divider'),
    '@nuralyui/document': path.join(nuralyUIPath, 'document'),
    '@nuralyui/dropdown': path.join(nuralyUIPath, 'dropdown'),
    '@nuralyui/file-upload': path.join(nuralyUIPath, 'file-upload'),
    '@nuralyui/flex': path.join(nuralyUIPath, 'flex'),
    '@nuralyui/forms': path.join(nuralyUIPath, 'form'),
    '@nuralyui/grid': path.join(nuralyUIPath, 'grid'),
    '@nuralyui/icon': path.join(nuralyUIPath, 'icon'),
    '@nuralyui/image': path.join(nuralyUIPath, 'image'),
    '@nuralyui/input': path.join(nuralyUIPath, 'input'),
    '@nuralyui/label': path.join(nuralyUIPath, 'label'),
    '@nuralyui/layout': path.join(nuralyUIPath, 'layout'),
    '@nuralyui/menu': path.join(nuralyUIPath, 'menu'),
    '@nuralyui/modal': path.join(nuralyUIPath, 'modal'),
    '@nuralyui/panel': path.join(nuralyUIPath, 'panel'),
    '@nuralyui/popconfirm': path.join(nuralyUIPath, 'popconfirm'),
    '@nuralyui/radio': path.join(nuralyUIPath, 'radio'),
    '@nuralyui/select': path.join(nuralyUIPath, 'select'),
    '@nuralyui/skeleton': path.join(nuralyUIPath, 'skeleton'),
    '@nuralyui/slider-input': path.join(nuralyUIPath, 'slider-input'),
    '@nuralyui/table': path.join(nuralyUIPath, 'table'),
    '@nuralyui/tabs': path.join(nuralyUIPath, 'tabs'),
    '@nuralyui/tag': path.join(nuralyUIPath, 'tag'),
    '@nuralyui/textarea': path.join(nuralyUIPath, 'textarea'),
    '@nuralyui/timeline': path.join(nuralyUIPath, 'timeline'),
    '@nuralyui/toast': path.join(nuralyUIPath, 'toast'),
    '@nuralyui/video': path.join(nuralyUIPath, 'video'),
    '@nuralyui/radio-group': path.join(nuralyUIPath, 'radio-group'),
    '@nuralyui/iconpicker': path.join(nuralyUIPath, 'iconpicker'),
    '@nuralyui/container': path.join(nuralyUIPath, 'container'),
    '@nuralyui/code-editor': path.join(nuralyUIPath, 'code-editor'),
    '@nuralyui/common/controllers': path.join(nuralyCommonPath, 'controllers.ts'),
    '@nuralyui/common/mixins': path.join(nuralyCommonPath, 'mixins.ts'),
    '@nuralyui/common/utils': path.join(nuralyCommonPath, 'utils.ts'),
    '@nuralyui/common/themes': path.join(nuralyCommonPath, 'themes.ts'),
    '@nuralyui/common': path.join(nuralyCommonPath, 'index.ts'),
  };
}

/**
 * Resolves the NuralyUI source path. Checks:
 * 1. Sibling to the lumenjs lib (in-repo development)
 * 2. Under the studio service path (Docker context)
 */
export function resolveNuralyUIPaths(projectDir: string): { componentsPath: string; commonPath: string } | null {
  const candidates = [
    // In-repo: libs/lumenjs → services/studio/...
    path.resolve(__dirname, '../../..', 'services/studio/src/features/runtime/components/ui/nuraly-ui'),
    // Docker: /home/node/app/libs/lumenjs → studio mounted
    path.resolve('/home/node/app/services/studio/src/features/runtime/components/ui/nuraly-ui'),
    // Fallback: check NURALYUI_PATH env
    process.env.NURALYUI_PATH || '',
  ];

  for (const base of candidates) {
    if (!base) continue;
    const componentsPath = path.join(base, 'src/components');
    const commonPath = path.join(base, 'packages/common/src');
    if (fs.existsSync(componentsPath)) {
      return { componentsPath, commonPath };
    }
  }
  return null;
}

/**
 * Returns the path to lumenjs's own node_modules.
 */
export function getLumenJSNodeModules(): string {
  return path.resolve(__dirname, '../../node_modules');
}

/**
 * Returns paths to lumenjs's compiled dist/ runtime and editor directories.
 */
export function getLumenJSDirs(): { distDir: string; runtimeDir: string; editorDir: string } {
  const lumenRoot = path.resolve(__dirname, '../..');
  const distDir = path.join(lumenRoot, 'dist');
  return {
    distDir,
    runtimeDir: path.join(distDir, 'runtime'),
    editorDir: path.join(distDir, 'editor'),
  };
}

export interface ProjectConfig {
  title: string;
  integrations: string[];
}

/**
 * Reads the project config from lumenjs.config.ts.
 */
export function readProjectConfig(projectDir: string): ProjectConfig {
  let title = 'LumenJS App';
  let integrations: string[] = [];
  const configPath = path.join(projectDir, 'lumenjs.config.ts');
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const titleMatch = configContent.match(/title\s*:\s*['"]([^'"]+)['"]/);
      if (titleMatch) title = titleMatch[1];
      const intMatch = configContent.match(/integrations\s*:\s*\[([^\]]*)\]/);
      if (intMatch) {
        integrations = intMatch[1]
          .split(',')
          .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }
    } catch { /* use defaults */ }
  }
  return { title, integrations };
}

/**
 * Reads the project title from lumenjs.config.ts (or returns default).
 * @deprecated Use readProjectConfig() instead.
 */
export function readProjectTitle(projectDir: string): string {
  return readProjectConfig(projectDir).title;
}

/**
 * Returns shared Vite config used by both dev and production builds.
 * Includes NuralyUI aliases, lit dedup, loaders strip, auto-import, and virtual modules.
 */
export function getSharedViteConfig(projectDir: string, options?: { mode?: 'development' | 'production'; integrations?: string[] }): {
  resolve: UserConfig['resolve'];
  esbuild: UserConfig['esbuild'];
  plugins: Plugin[];
} {
  const mode = options?.mode || 'development';
  const isDev = mode === 'development';
  const pagesDir = path.join(projectDir, 'pages');
  const lumenNodeModules = getLumenJSNodeModules();
  const { runtimeDir, editorDir } = getLumenJSDirs();

  // Resolve NuralyUI paths for aliases
  const nuralyUIPaths = resolveNuralyUIPaths(projectDir);
  const aliases: Record<string, string> = {};
  if (nuralyUIPaths) {
    Object.assign(aliases, getNuralyUIAliases(nuralyUIPaths.componentsPath, nuralyUIPaths.commonPath));
  }

  const resolve: UserConfig['resolve'] = {
    alias: { ...aliases },
    conditions: isDev ? ['development', 'browser'] : ['browser'],
    dedupe: ['lit', 'lit-html', 'lit-element', '@lit/reactive-element'],
  };

  const esbuild: UserConfig['esbuild'] = {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      }
    }
  };

  const plugins: Plugin[] = [
    lumenRoutesPlugin(pagesDir),
    lumenLoadersPlugin(pagesDir),
    // Force ALL lit imports to resolve to lumenjs's single lit copy.
    {
      name: 'lumenjs-lit-dedup',
      enforce: 'pre' as const,
      resolveId(source: string, importer: string | undefined, options?: { ssr?: boolean }) {
        if (!importer) return;
        const isLitImport = source === 'lit' || source.startsWith('lit/')
          || source === 'lit-html' || source.startsWith('lit-html/')
          || source === 'lit-element' || source.startsWith('lit-element/')
          || source === '@lit/reactive-element' || source.startsWith('@lit/reactive-element/')
          || source === '@lit-labs/ssr' || source.startsWith('@lit-labs/ssr/')
          || source === '@lit-labs/ssr-client' || source.startsWith('@lit-labs/ssr-client/')
          || source === '@lit-labs/ssr-dom-shim' || source.startsWith('@lit-labs/ssr-dom-shim/');
        if (!isLitImport) return;

        const parts = source.split('/');
        const pkgName = source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        const subpath = source.startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/');
        const pkgDir = path.join(lumenNodeModules, pkgName);
        if (!fs.existsSync(pkgDir)) return;

        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
          const exports = pkg.exports;
          if (exports) {
            const exportKey = subpath ? './' + subpath : '.';
            const entry = exports[exportKey];
            if (entry) {
              let resolved: string | undefined;
              if (options?.ssr) {
                resolved = isDev
                  ? (entry?.node?.development || entry?.node?.default || entry?.node || entry?.development || entry?.default || entry)
                  : (entry?.node?.default || entry?.node || entry?.default || entry);
              } else {
                resolved = isDev
                  ? (entry?.browser?.development || entry?.development || entry?.browser?.default || entry?.default || entry)
                  : (entry?.browser?.default || entry?.browser || entry?.default || entry);
              }
              if (typeof resolved === 'string') {
                return path.join(pkgDir, resolved);
              }
            }
          }
          if (subpath) {
            return path.join(pkgDir, subpath);
          }
          const entry = pkg.module || pkg.main || 'index.js';
          return path.join(pkgDir, entry);
        } catch {
          return subpath ? path.join(pkgDir, subpath) : pkgDir;
        }
      }
    },
    // Auto-import NuralyUI components based on nr-* tags used in html`` templates
    {
      name: 'lumenjs-auto-import',
      transform(code: string, id: string) {
        if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
        if (!code.includes('html`')) return;

        const tagToPackage: Record<string, string> = {
          'nr-alert': '@nuralyui/alert',
          'nr-badge': '@nuralyui/badge',
          'nr-breadcrumb': '@nuralyui/breadcrumb',
          'nr-button': '@nuralyui/button',
          'nr-canvas': '@nuralyui/canvas',
          'nr-card': '@nuralyui/card',
          'nr-chatbot': '@nuralyui/chatbot',
          'nr-checkbox': '@nuralyui/checkbox',
          'nr-collapse': '@nuralyui/collapse',
          'nr-color-picker': '@nuralyui/color-picker',
          'nr-datepicker': '@nuralyui/datepicker',
          'nr-divider': '@nuralyui/divider',
          'nr-document': '@nuralyui/document',
          'nr-dropdown': '@nuralyui/dropdown',
          'nr-file-upload': '@nuralyui/file-upload',
          'nr-flex': '@nuralyui/flex',
          'nr-form': '@nuralyui/forms',
          'nr-grid': '@nuralyui/grid',
          'nr-icon': '@nuralyui/icon',
          'nr-image': '@nuralyui/image',
          'nr-input': '@nuralyui/input',
          'nr-label': '@nuralyui/label',
          'nr-layout': '@nuralyui/layout',
          'nr-menu': '@nuralyui/menu',
          'nr-modal': '@nuralyui/modal',
          'nr-panel': '@nuralyui/panel',
          'nr-popconfirm': '@nuralyui/popconfirm',
          'nr-radio': '@nuralyui/radio',
          'nr-select': '@nuralyui/select',
          'nr-skeleton': '@nuralyui/skeleton',
          'nr-slider-input': '@nuralyui/slider-input',
          'nr-table': '@nuralyui/table',
          'nr-tabs': '@nuralyui/tabs',
          'nr-tag': '@nuralyui/tag',
          'nr-textarea': '@nuralyui/textarea',
          'nr-timeline': '@nuralyui/timeline',
          'nr-toast': '@nuralyui/toast',
          'nr-video': '@nuralyui/video',
          'nr-radio-group': '@nuralyui/radio-group',
          'nr-iconpicker': '@nuralyui/iconpicker',
          'nr-container': '@nuralyui/container',
          'nr-code-editor': '@nuralyui/code-editor',
        };

        const imports: string[] = [];
        for (const [tag, pkg] of Object.entries(tagToPackage)) {
          if (code.includes(`<${tag}`) && !code.includes(`'${pkg}'`) && !code.includes(`"${pkg}"`)) {
            imports.push(`import '${pkg}';`);
          }
        }
        if (imports.length === 0) return;

        return { code: imports.join('\n') + '\n' + code, map: null };
      }
    },
    {
      name: 'lumenjs-virtual-modules',
      resolveId(id) {
        if (id === '/@lumenjs/app-shell') return '\0lumenjs:app-shell';
        if (id === '/@lumenjs/router') return '\0lumenjs:router';
        if (id === '/@lumenjs/editor-bridge') return '\0lumenjs:editor-bridge';
        if (id === '/@lumenjs/element-annotator') return '\0lumenjs:element-annotator';
      },
      load(id) {
        if (id === '\0lumenjs:app-shell') {
          let code = fs.readFileSync(path.join(runtimeDir, 'app-shell.js'), 'utf-8');
          code = code.replace(/from\s+['"]\.\/router\.js['"]/g, "from '/@lumenjs/router'");
          return code;
        }
        if (id === '\0lumenjs:router') {
          return fs.readFileSync(path.join(runtimeDir, 'router.js'), 'utf-8');
        }
        if (id === '\0lumenjs:editor-bridge') {
          let code = fs.readFileSync(path.join(editorDir, 'editor-bridge.js'), 'utf-8');
          code = code.replace(/from\s+['"]\.\/element-annotator\.js['"]/g, "from '/@lumenjs/element-annotator'");
          return code;
        }
        if (id === '\0lumenjs:element-annotator') {
          return fs.readFileSync(path.join(editorDir, 'element-annotator.js'), 'utf-8');
        }
      }
    },
  ];

  // Conditionally add Tailwind plugin from the project's node_modules
  if (options?.integrations?.includes('tailwind')) {
    try {
      const projectRequire = createRequire(pathToFileURL(path.join(projectDir, 'package.json')).href);
      const tailwindMod = projectRequire('@tailwindcss/vite');
      const tailwindPlugin = tailwindMod.default || tailwindMod;
      plugins.unshift(tailwindPlugin());
    } catch {
      console.warn('[LumenJS] Tailwind integration enabled but @tailwindcss/vite not found. Run: lumenjs add tailwind');
    }
  }

  return { resolve, esbuild, plugins };
}

export async function createDevServer(options: DevServerOptions): Promise<ViteDevServer> {
  const { projectDir, port, editorMode = false, base = '/' } = options;
  const pagesDir = path.join(projectDir, 'pages');
  const apiDir = path.join(projectDir, 'api');
  const publicDir = path.join(projectDir, 'public');

  const config = readProjectConfig(projectDir);
  const { title, integrations } = config;
  const shared = getSharedViteConfig(projectDir, { integrations });

  const server = await createViteServer({
    root: projectDir,
    publicDir: fs.existsSync(publicDir) ? publicDir : undefined,
    server: {
      port,
      host: true,
      strictPort: false,
      allowedHosts: true,
      cors: true,
      hmr: true,
    },
    resolve: shared.resolve,
    plugins: [
      ...shared.plugins,
      lumenApiRoutesPlugin(apiDir, projectDir),
      // Lit HMR plugin — patches existing custom element prototypes instead of re-registering.
      {
        name: 'lumenjs-lit-hmr',
        enforce: 'post' as const,
        transform(code: string, id: string) {
          if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
          const match = code.match(/(\w+)\s*=\s*__decorateClass\(\s*\[\s*\n?\s*customElement\(\s*"([^"]+)"\s*\)\s*\n?\s*\]\s*,\s*\1\s*\)/);
          if (!match) return;
          const [fullMatch, className, tagName] = match;

          const transformed = code.replace(fullMatch,
            `if (!customElements.get("${tagName}")) {\n  customElements.define("${tagName}", ${className});\n}`
          ) + `
// --- Lit HMR ---
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (!newModule) return;
    const NewClass = newModule.${className};
    if (!NewClass) return;
    const OldClass = customElements.get("${tagName}");
    if (!OldClass) return;
    const descriptors = Object.getOwnPropertyDescriptors(NewClass.prototype);
    for (const [key, desc] of Object.entries(descriptors)) {
      if (key === "constructor") continue;
      Object.defineProperty(OldClass.prototype, key, desc);
    }
    if (NewClass.styles) {
      OldClass.styles = NewClass.styles;
      OldClass.elementStyles = undefined;
      OldClass.finalizeStyles();
    }
    if (NewClass.properties) {
      OldClass.properties = NewClass.properties;
    }
    document.querySelectorAll("${tagName}").forEach((el) => {
      if (el.requestUpdate) el.requestUpdate();
    });
  });
}
`;
          return { code: transformed, map: null };
        }
      },
      // In editor mode, inject data-nk-source attributes into html`` template literals
      ...(editorMode ? [{
        name: 'lumenjs-source-annotator',
        transform(code: string, id: string) {
          if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
          if (!code.includes('html`')) return;

          const relativePath = path.relative(projectDir, id);
          const transformed = code.replace(/html`([\s\S]*?)`/g, (match, templateContent: string) => {
            let offset = 0;
            const beforeTemplate = code.substring(0, code.indexOf(match));
            const baseLine = beforeTemplate.split('\n').length;

            const annotated = templateContent.replace(/<([a-z][a-z0-9]*-[a-z0-9-]*)([\s>])/gi, (tagMatch: string, tagName: string, after: string) => {
              const beforeTag = templateContent.substring(0, templateContent.indexOf(tagMatch, offset));
              const lineInTemplate = beforeTag.split('\n').length - 1;
              offset = templateContent.indexOf(tagMatch, offset) + tagMatch.length;
              const line = baseLine + lineInTemplate;
              return `<${tagName} data-nk-source="${relativePath}:${line}"${after}`;
            });
            const dynamicAnnotated = annotated.replace(
              /<(h[1-6]|p|span|a|label|li|button|div)(\s[^>]*)?>([^<]*\$\{[^<]*)<\//gi,
              (m, tag, attrs, content) => {
                const attrStr = attrs || '';
                if (attrStr.includes('data-nk-dynamic')) return m;
                const escaped = content.trim().replace(/"/g, '&quot;').replace(/\$\{/g, '__NK_EXPR__');
                return `<${tag}${attrStr} data-nk-dynamic="${escaped}">${content}</`;
              }
            );
            return 'html`' + dynamicAnnotated + '`';
          });
          if (transformed !== code) {
            return { code: transformed, map: null };
          }
        }
      }] : []),
      {
        name: 'lumenjs-index-html',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && !req.url.startsWith('/@') && !req.url.startsWith('/node_modules') &&
                !req.url.startsWith('/api/') && !req.url.startsWith('/__nk_loader/') &&
                !req.url.includes('.') && req.method === 'GET') {
              const pathname = req.url.split('?')[0];
              const SSR_PLACEHOLDER = '<!--__NK_SSR_CONTENT__-->';
              ssrRenderPage(server, pagesDir, pathname, req.headers as Record<string, string | string[] | undefined>).then(async ssrResult => {
                if (ssrResult?.redirect) {
                  res.writeHead(ssrResult.redirect.status, { Location: ssrResult.redirect.location });
                  res.end();
                  return;
                }
                const shellHtml = generateIndexHtml({
                  title,
                  editorMode,
                  ssrContent: ssrResult ? SSR_PLACEHOLDER : undefined,
                  loaderData: ssrResult?.loaderData,
                  integrations,
                });
                const transformed = await server.transformIndexHtml(req.url!, shellHtml);
                const finalHtml = ssrResult
                  ? transformed.replace(SSR_PLACEHOLDER, ssrResult.html)
                  : transformed;
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Cache-Control', 'no-store');
                res.end(finalHtml);
              }).catch(err => {
                console.error('[LumenJS] SSR/HTML generation error:', err);
                const html = generateIndexHtml({ title, editorMode, integrations });
                server.transformIndexHtml(req.url!, html).then(transformed => {
                  res.setHeader('Content-Type', 'text/html');
                  res.setHeader('Cache-Control', 'no-store');
                  res.end(transformed);
                }).catch(next);
              });
              return;
            }
            next();
          });
        }
      }
    ],
    esbuild: shared.esbuild,
    optimizeDeps: {
      include: ['lit', 'lit/decorators.js', 'lit/directive.js', 'lit/directive-helpers.js', 'lit/async-directive.js', 'lit-html', 'lit-element', '@lit/reactive-element'],
    },
    ssr: {
      noExternal: true,
      external: ['node-domexception'],
      resolve: {
        conditions: ['node', 'import'],
      },
    },
  });

  return server;
}
