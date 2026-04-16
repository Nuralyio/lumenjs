export interface LlmsPage {
  path: string;
  hasLoader: boolean;
  hasSubscribe: boolean;
  loaderData?: any;
  dynamicEntries?: { path: string; loaderData: any }[];
}

export interface LlmsApiRoute {
  path: string;
  methods: string[];
}

export interface LlmsTxtInput {
  title: string;
  description?: string;
  baseUrl?: string;
  pages: LlmsPage[];
  apiRoutes: LlmsApiRoute[];
  integrations: string[];
  i18n?: { locales: string[]; defaultLocale: string };
  db?: { path?: string };
}

/**
 * Generate the llms.txt content following the llmstxt.org spec.
 *
 * Structure: H1 title, blockquote summary, H2 sections with
 * markdown links to each page (linking to .md versions).
 */
export function generateLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [];

  lines.push(`# ${input.title}`);
  lines.push('');
  lines.push(`> ${input.description || 'Built with LumenJS'}`);
  lines.push('');

  // Pages section
  if (input.pages.length > 0) {
    lines.push('## Pages');
    lines.push('');
    for (const page of input.pages) {
      const isDynamic = page.path.includes(':');
      lines.push(`### ${page.path}`);

      if (isDynamic) {
        const hasEntries = page.dynamicEntries && page.dynamicEntries.length > 0;
        if (hasEntries) {
          const count = page.dynamicEntries!.length;
          lines.push(`Dynamic route — ${count} ${count === 1 ? 'entry' : 'entries'}:`);
          lines.push('');
          for (const entry of page.dynamicEntries!) {
            lines.push(`#### ${entry.path}`);
            if (entry.loaderData) {
              const data = flattenData(entry.loaderData);
              if (data) lines.push(data);
            }
            lines.push('');
          }
        } else {
          lines.push('- Dynamic route');
          lines.push('');
        }
      } else {
        const features: string[] = [];
        if (page.hasLoader) features.push('with loader data');
        if (page.hasSubscribe) features.push('with live data');
        const annotation = features.length > 0
          ? `- Server-rendered page ${features.join(' and ')}`
          : '- Server-rendered page';
        lines.push(annotation);
        if (page.loaderData) {
          const data = flattenData(page.loaderData);
          if (data) lines.push(data);
        }
        lines.push('');
      }
    }
  }

  // API Routes section
  if (input.apiRoutes.length > 0) {
    lines.push('## API Routes');
    lines.push('');
    for (const route of input.apiRoutes) {
      for (const method of route.methods) {
        lines.push(`- ${method} /api/${route.path}`);
      }
    }
    lines.push('');
  }

  // Features section
  const features: string[] = [];
  if (input.db) features.push('SQLite Database');
  if (input.i18n) {
    features.push(`Internationalization (${input.i18n.locales.join(', ')})`);
  }
  for (const integration of input.integrations) {
    if (integration === 'tailwind') features.push('Tailwind CSS');
    else if (integration === 'nuralyui') features.push('NuralyUI Components');
    else features.push(integration);
  }

  if (features.length > 0) {
    lines.push('## Features');
    lines.push('');
    for (const feature of features) {
      lines.push(`- ${feature}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Generate llms-full.txt — all page content inlined as one markdown document.
 */
export function generateLlmsFullTxt(input: LlmsTxtInput & { pageContents: { path: string; markdown: string }[] }): string {
  const lines: string[] = [];

  lines.push(`# ${input.title}`);
  lines.push('');
  lines.push(`> ${input.description || `${input.title}. Built with LumenJS.`}`);
  lines.push('');

  for (const page of input.pageContents) {
    lines.push('---');
    lines.push(`source: ${page.path}`);
    lines.push('---');
    lines.push('');
    lines.push(page.markdown.trim());
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Flatten a loader data object into key-value text lines.
 */
function flattenData(data: any, prefix = ''): string {
  if (data == null) return '';
  if (typeof data !== 'object') return `${prefix}${String(data)}`;

  // If it's an array, skip it (arrays are for lists, not flat display)
  if (Array.isArray(data)) return '';

  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(flattenData(value, `${prefix}${key}.`));
    } else if (Array.isArray(value)) {
      // Skip arrays in flat display
      continue;
    } else {
      const strVal = String(value);
      // Truncate very long values
      const displayVal = strVal.length > 300 ? strVal.slice(0, 300) + '...' : strVal;
      lines.push(`${prefix}${key}: ${displayVal}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}

/**
 * Try to resolve dynamic route entries by finding a parent/sibling index page
 * whose loader returns an array, then calling the dynamic page's loader for each item.
 */
export async function resolveDynamicEntries(
  dynamicPage: { path: string; paramName: string },
  loadModule: (filePath: string) => Promise<any>,
  pages: { path: string; filePath: string; hasLoader: boolean }[],
): Promise<{ path: string; loaderData: any }[] | null> {
  // Extract the parent path from the dynamic route
  // e.g., /blog/:slug -> /blog, /docs/:id -> /docs
  const segments = dynamicPage.path.split('/');
  segments.pop(); // remove the dynamic segment
  const parentPath = segments.join('/') || '/';

  // Find parent or sibling index page with a loader
  const indexPage = pages.find(p =>
    p.hasLoader && (p.path === parentPath || p.path === parentPath + '/')
  );

  if (!indexPage) return null;

  try {
    const indexMod = await loadModule(indexPage.filePath);
    if (!indexMod?.loader) return null;

    const indexData = await indexMod.loader({ params: {}, query: {}, url: indexPage.path, headers: {} });
    if (!indexData || typeof indexData !== 'object') return null;

    // Find the array in the loader data (look for the first array value)
    let items: any[] | null = null;
    for (const value of Object.values(indexData)) {
      if (Array.isArray(value)) {
        items = value;
        break;
      }
    }
    // If the returned data is itself an array
    if (!items && Array.isArray(indexData)) {
      items = indexData;
    }

    if (!items || items.length === 0) return null;

    // For each item, try to call the dynamic page's loader
    const dynamicMod = await loadModule(
      pages.find(p => p.path === dynamicPage.path)?.filePath || ''
    );
    if (!dynamicMod?.loader) return null;

    const entries: { path: string; loaderData: any }[] = [];
    for (const item of items) {
      // Try to extract the param value from the item
      const paramValue = item[dynamicPage.paramName] || item.slug || item.id || item.name;
      if (!paramValue) continue;

      try {
        const loaderData = await dynamicMod.loader({
          params: { [dynamicPage.paramName]: String(paramValue) },
          query: {},
          url: dynamicPage.path.replace(`:${dynamicPage.paramName}`, String(paramValue)),
          headers: {},
        });
        if (loaderData) {
          const resolvedPath = dynamicPage.path.replace(`:${dynamicPage.paramName}`, String(paramValue));
          entries.push({ path: resolvedPath, loaderData });
        }
      } catch {
        // Skip items whose loader fails
      }
    }

    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}
