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
