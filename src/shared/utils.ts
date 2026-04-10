import fs from 'fs';
import path from 'path';

/**
 * Strip the outer Lit SSR template markers from rendered HTML.
 * Lit SSR wraps every template render in <!--lit-part HASH-->...<!--/lit-part-->.
 * When inserting SSR HTML as light DOM (slot content), these markers must be
 * removed so the parent element's hydration doesn't see a TemplateResult part.
 */
export function stripOuterLitMarkers(html: string): string {
  let result = html.replace(/^(<!--lit-part [^>]*-->)(\s*<!--lit-node \d+-->)?/, '');
  result = result.replace(/<!--\/lit-part-->\s*$/, '');
  return result;
}

/**
 * Convert a relative directory path within pages/ to a layout tag name.
 *   ''          → 'layout-root'
 *   'dashboard' → 'layout-dashboard'
 *   'app/[id]'  → 'layout-app-id'
 */
export function dirToLayoutTagName(dir: string): string {
  if (!dir) return 'layout-root';
  const name = dir
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/\[\.\.\.([^\]]+)\]/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .toLowerCase();
  return `layout-${name}`;
}

/**
 * Convert a relative file path within pages/ to a page tag name.
 *   'index.ts'           → 'page-index'
 *   'docs/api-routes.ts' → 'page-docs-api-routes'
 *   'blog/[slug].ts'     → 'page-blog-slug'
 */
export function filePathToTagName(filePath: string): string {
  const name = filePath
    .replace(/\.(ts|js)$/, '')
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/\[\.\.\.([^\]]+)\]/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .toLowerCase();
  return `page-${name}`;
}

/**
 * Check if a redirect response was returned from a loader.
 */
export function isRedirectResponse(value: any): value is { location: string; status?: number } {
  return value && typeof value === 'object' && typeof value.location === 'string' && value.__nk_redirect === true;
}

/**
 * Patch a custom element class's loaderData setter to also spread
 * individual properties from the loader data object onto the element.
 * This enables components to declare individual reactive properties
 * (e.g., `stats: { type: Array }`) instead of using `this.loaderData.stats`.
 *
 * Must be called AFTER the element is registered and BEFORE SSR rendering.
 */
export function patchLoaderDataSpread(tagName: string): void {
  const g = globalThis as any;
  const ElementClass = g.customElements?.get?.(tagName);
  if (!ElementClass) return;

  const proto = ElementClass.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'loaderData');

  Object.defineProperty(proto, 'loaderData', {
    set(value: any) {
      if (original?.set) {
        original.set.call(this, value);
      } else {
        this.__nk_loaderData = value;
      }
      if (value && typeof value === 'object') {
        const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'loaderData',
          'render', 'connectedCallback', 'disconnectedCallback', 'attributeChangedCallback',
          'adoptedCallback', 'innerHTML', 'outerHTML', 'textContent']);
        for (const [key, val] of Object.entries(value)) {
          if (!BLOCKED_KEYS.has(key)) {
            (this as any)[key] = val;
          }
        }
      }
    },
    get() {
      if (original?.get) return original.get.call(this);
      return this.__nk_loaderData;
    },
    configurable: true
  });
}

/**
 * Read and parse the body of an HTTP request.
 */
const DEFAULT_MAX_BODY = 1024 * 1024; // 1 MB

export function readBody(req: any, maxSize: number = DEFAULT_MAX_BODY): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      data += chunk.toString();
    });
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        // Retry: escape lone backslashes (common in Windows paths like C:\Users)
        // that aren't valid JSON escape sequences (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX)
        try {
          const fixed = data.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
          resolve(JSON.parse(fixed));
        } catch {
          resolve(data);
        }
      }
    });
    req.on('error', reject);
  });
}

/**
 * Unwrap a Response object (e.g. from Response.json()) into a plain value.
 * JSON.stringify(Response) produces '{}', so we must extract the body first.
 */
export async function unwrapResponse(result: any): Promise<any> {
  if (result && typeof result === 'object' && typeof result.json === 'function' && typeof result.status === 'number' && typeof result.headers === 'object' && typeof result.ok === 'boolean') {
    try {
      return await result.json();
    } catch {
      return null;
    }
  }
  return result;
}

/**
 * Load a .env file into process.env without dotenv (which crashes in Vite ESM SSR).
 * Uses fs.readFileSync — safe in both CJS and ESM contexts.
 * Skips variables already set in process.env (environment takes precedence).
 */
export function loadEnvFile(dir: string): void {
  const envPath = path.join(dir, '.env');
  let content: string;
  try {
    content = fs.readFileSync(envPath, 'utf-8');
  } catch {
    return; // .env doesn't exist — that's fine
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't override existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Escape HTML special characters for safe embedding.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Check if code has a top-level export of a named function (before the class definition).
 * In LumenJS, loader/subscribe are always declared before `export class`.
 */
function hasTopLevelExport(content: string, fnName: string): boolean {
  const classStart = content.search(/export\s+class\s+\w+/);
  const fnRegex = new RegExp(`export\\s+(async\\s+)?function\\s+${fnName}\\s*\\(`);
  const match = fnRegex.exec(content);
  if (!match) return false;
  if (classStart >= 0 && match.index > classStart) return false;
  return true;
}

/**
 * Check if a page file exports `export const prerender = true`.
 */
export function fileHasPrerender(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return /export\s+const\s+prerender\s*=\s*true/.test(content);
  } catch { return false; }
}

/**
 * Check if a page/layout file exports a loader() function.
 */
export function fileHasLoader(filePath: string): boolean {
  try {
    // Check for co-located _loader.ts (folder route convention: index.ts + _loader.ts)
    if (path.basename(filePath).replace(/\.(ts|js)$/, '') === 'index') {
      const dir = path.dirname(filePath);
      if (fs.existsSync(path.join(dir, '_loader.ts')) || fs.existsSync(path.join(dir, '_loader.js'))) {
        return true;
      }
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return hasTopLevelExport(content, 'loader');
  } catch { return false; }
}

/**
 * Check if a page/layout file exports a subscribe() function.
 */
export function fileHasSubscribe(filePath: string): boolean {
  try {
    // Check for co-located _subscribe.ts (folder route convention: index.ts + _subscribe.ts)
    if (path.basename(filePath).replace(/\.(ts|js)$/, '') === 'index') {
      const dir = path.dirname(filePath);
      if (fs.existsSync(path.join(dir, '_subscribe.ts')) || fs.existsSync(path.join(dir, '_subscribe.js'))) {
        return true;
      }
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return hasTopLevelExport(content, 'subscribe');
  } catch { return false; }
}

/**
 * Check if a page file exports an `auth` constant (before the class definition).
 */
export function fileHasAuth(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const classStart = content.search(/export\s+class\s+\w+/);
    const match = /export\s+const\s+auth\s*=/.exec(content);
    if (!match) return false;
    if (classStart >= 0 && match.index > classStart) return false;
    return true;
  } catch { return false; }
}

/**
 * Check if a page file exports a `meta` object or function.
 * Supports both `export const meta = { ... }` and `export function meta(...)`.
 */
export function fileHasMeta(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const classStart = content.search(/export\s+class\s+\w+/);
    // Check for `export const meta` or `export function meta`
    const match = /export\s+(const\s+meta\s*=|(async\s+)?function\s+meta\s*\()/.exec(content);
    if (!match) return false;
    if (classStart >= 0 && match.index > classStart) return false;
    return true;
  } catch { return false; }
}

/**
 * Check if a page file exports a `socket` function or constant.
 */
export function fileHasSocket(filePath: string): boolean {
  try {
    // Check for co-located _socket.ts (folder route convention: index.ts + _socket.ts)
    if (path.basename(filePath).replace(/\.(ts|js)$/, '') === 'index') {
      const dir = path.dirname(filePath);
      if (fs.existsSync(path.join(dir, '_socket.ts')) || fs.existsSync(path.join(dir, '_socket.js'))) {
        return true;
      }
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return /export\s+(function|const)\s+socket[\s(=]/.test(content) ||
           /export\s*\{[^}]*\bsocket\b[^}]*\}/.test(content);
  } catch { return false; }
}

/**
 * Check if a page exports `standalone = true` (renders without any layout).
 */
export function fileHasStandalone(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const classStart = content.search(/export\s+class\s+\w+/);
    const match = /export\s+const\s+standalone\s*=/.exec(content);
    if (!match) return false;
    if (classStart >= 0 && match.index > classStart) return false;
    return true;
  } catch { return false; }
}

/**
 * Return the HTTP methods exported by an API route file (e.g. ['GET', 'POST']).
 */
export function fileGetApiMethods(filePath: string): string[] {
  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return HTTP_METHODS.filter(m => new RegExp(`export\\s+(async\\s+)?function\\s+${m}[\\s(]`).test(content));
  } catch { return []; }
}

/**
 * Convert a file path (relative to pages/) to a route path.
 */
export function filePathToRoute(filePath: string): string {
  let route = filePath
    .replace(/\.(ts|js)$/, '')
    .replace(/\\/g, '/')
    .replace(/\[\.\.\.([^\]]+)\]/g, ':...$1')
    .replace(/\[([^\]]+)\]/g, ':$1');

  if (route === 'index' || route.endsWith('/index')) {
    route = route.slice(0, -5).replace(/\/$/, '') || '/';
  }

  return route.startsWith('/') ? route : '/' + route;
}
