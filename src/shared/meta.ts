import { escapeHtml } from './utils.js';

export interface PageMeta {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  robots?: string;
  type?: string;
}

export interface MetaTagOptions {
  siteTitle?: string;
  url?: string;
  locale?: string;
  i18nConfig?: { locales: string[]; defaultLocale: string; prefixDefault: boolean };
}

/**
 * Generate HTML meta tags from a PageMeta object.
 * Returns a string of HTML tags to inject into <head>.
 */
export function generateMetaTags(meta: PageMeta, options?: MetaTagOptions): string {
  const tags: string[] = [];
  const ogType = meta.type || 'website';

  // og:type is always emitted
  tags.push(`<meta property="og:type" content="${escapeHtml(ogType)}">`);

  if (meta.description) {
    tags.push(`<meta name="description" content="${escapeHtml(meta.description)}">`);
    tags.push(`<meta property="og:description" content="${escapeHtml(meta.description)}">`);
  }

  if (meta.title) {
    const fullTitle = options?.siteTitle ? `${meta.title} | ${options.siteTitle}` : meta.title;
    tags.push(`<meta property="og:title" content="${escapeHtml(fullTitle)}">`);
  }

  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}">`);
    tags.push(`<meta name="twitter:card" content="summary_large_image">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}">`);
  }

  if (meta.robots) {
    tags.push(`<meta name="robots" content="${escapeHtml(meta.robots)}">`);
  }

  if (options?.url) {
    tags.push(`<meta property="og:url" content="${escapeHtml(options.url)}">`);
  }

  if (options?.locale) {
    tags.push(`<meta property="og:locale" content="${escapeHtml(options.locale)}">`);
  }

  // Canonical URL
  const canonicalUrl = meta.canonical || options?.url;
  if (canonicalUrl) {
    tags.push(`<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`);
  }

  // hreflang tags for i18n
  if (options?.i18nConfig && options.url) {
    const { locales, defaultLocale, prefixDefault } = options.i18nConfig;
    // Strip any existing locale prefix to get the base path
    let basePath = options.url;
    for (const loc of locales) {
      if (basePath.startsWith(`/${loc}/`) || basePath === `/${loc}`) {
        basePath = basePath.slice(loc.length + 1) || '/';
        break;
      }
    }

    for (const loc of locales) {
      const href = (loc === defaultLocale && !prefixDefault)
        ? basePath
        : `/${loc}${basePath === '/' ? '' : basePath}`;
      tags.push(`<link rel="alternate" hreflang="${escapeHtml(loc)}" href="${escapeHtml(href)}">`);
    }

    // x-default points to the default locale URL
    const xDefaultHref = prefixDefault
      ? `/${defaultLocale}${basePath === '/' ? '' : basePath}`
      : basePath;
    tags.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(xDefaultHref)}">`);
  }

  return tags.join('\n  ');
}

/**
 * Compute the full page title with optional site title suffix.
 */
export function computeTitle(meta: PageMeta | undefined, siteTitle: string): string {
  if (meta?.title) {
    return `${meta.title} | ${siteTitle}`;
  }
  return siteTitle;
}

/** The context a `meta` function is called with, on both sides. */
export interface MetaContext {
  data?: unknown;
  params?: Record<string, string>;
}

type MetaExport = PageMeta | ((ctx: MetaContext) => PageMeta | Promise<PageMeta>);

/**
 * A page module's `meta`, resolved on the server.
 *
 * The client router already reads this export to set document.title after a
 * navigation. Doing it there and only there means the first response carries
 * the project's one configured title, which is what a crawler, a link
 * unfurler and a shared URL all see. Same export, same call signature; this
 * is the half that runs before the page does.
 *
 * Never throws. A page that cannot describe itself still has to be served.
 */
export async function resolvePageMeta(
  mod: { meta?: MetaExport } | null | undefined,
  ctx: MetaContext
): Promise<PageMeta | null> {
  const said = mod?.meta;
  if (!said) return null;
  try {
    const meta = typeof said === 'function' ? await said(ctx) : said;
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Tags this meta is about to write, removed from what the document already
 * carries. A project's head.html usually states a description and an og:title
 * for the site as a whole, and two of either is a tag a crawler chooses
 * between — so the page's wins and the document's goes.
 */
function withoutConflicts(html: string, meta: PageMeta, hasUrl: boolean): string {
  const drop = (attr: 'name' | 'property', value: string): void => {
    html = html.replace(
      new RegExp(`[ \\t]*<meta\\s+${attr}=["']${value}["'][^>]*>\\s*\\n?`, 'gi'), ''
    );
  };
  // og:type is always emitted by generateMetaTags, so the document's own
  // always conflicts.
  drop('property', 'og:type');
  if (meta.description) { drop('name', 'description'); drop('property', 'og:description'); }
  if (meta.title) drop('property', 'og:title');
  if (meta.image) {
    drop('property', 'og:image');
    drop('name', 'twitter:card');
    drop('name', 'twitter:image');
  }
  if (meta.robots) drop('name', 'robots');
  if (hasUrl) drop('property', 'og:url');
  if (meta.canonical || hasUrl) {
    html = html.replace(/[ \t]*<link\s+rel=["']canonical["'][^>]*>\s*\n?/gi, '');
  }
  return html;
}

/**
 * A page's meta, written into a document that already exists.
 *
 * A whole string rather than a stream, deliberately: the title is replaced in
 * place, conflicting tags are removed, and the rest goes in before `</head>`.
 * A document with no `</head>` comes back untouched rather than guessed at.
 */
export function applyMetaToDocument(
  html: string,
  meta: PageMeta | null | undefined,
  options?: MetaTagOptions
): string {
  if (!meta) return html;
  if (!/<\/head>/i.test(html)) return html;

  let out = html;
  if (meta.title) {
    const title = escapeHtml(computeTitle(meta, options?.siteTitle ?? ''));
    const replaced = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    out = replaced !== out ? replaced : out.replace(/<\/head>/i, `  <title>${title}</title>\n</head>`);
    // The site's own name, stamped so the client router does not read the
    // tab and take this page's title for it.
    if (options?.siteTitle) {
      const stamp = `<meta name="nk-site-title" content="${escapeHtml(options.siteTitle)}">`;
      out = /<meta\s+name=["']nk-site-title["'][^>]*>/i.test(out)
        ? out.replace(/<meta\s+name=["']nk-site-title["'][^>]*>/i, stamp)
        : out.replace(/<\/head>/i, `  ${stamp}\n</head>`);
    }
  }
  out = withoutConflicts(out, meta, Boolean(options?.url));
  const tags = generateMetaTags(meta, options);
  return tags === '' ? out : out.replace(/<\/head>/i, `  ${tags}\n</head>`);
}
