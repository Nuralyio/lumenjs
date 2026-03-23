import fs from 'fs';

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
 * Find the custom element tag name from a page module.
 * Pages are auto-registered by the auto-define plugin based on file path.
 */
export function findTagName(mod: Record<string, any>): string | null {
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (typeof val === 'function' && val.prototype) {
      if (val.is) return val.is;
      if (val.elementProperties || val.properties) {
        const className = val.name || key;
        const tag = className
          .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
          .toLowerCase();
        if (tag.includes('-')) return tag;
      }
    }
  }
  return null;
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
        for (const [key, val] of Object.entries(value)) {
          if (key !== 'loaderData') {
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
export function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(data);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Escape HTML special characters for safe embedding.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
 * Check if a page/layout file exports a loader() function.
 */
export function fileHasLoader(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return hasTopLevelExport(content, 'loader');
  } catch { return false; }
}

/**
 * Check if a page/layout file exports a subscribe() function.
 */
export function fileHasSubscribe(filePath: string): boolean {
  try {
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
