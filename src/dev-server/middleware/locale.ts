import type { IncomingMessage } from 'http';

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  prefixDefault: boolean;
}

export interface LocaleResult {
  locale: string;
  pathname: string;
}

/**
 * Extract the locale from the request URL, cookie, or Accept-Language header.
 * Returns the resolved locale and the pathname with the locale prefix stripped.
 *
 * Resolution order:
 *   1. URL prefix: /fr/about → locale "fr", pathname "/about"
 *   2. Cookie "nk-locale"
 *   3. Accept-Language header
 *   4. Config defaultLocale
 */
export function resolveLocale(
  pathname: string,
  config: I18nConfig,
  headers?: Record<string, string | string[] | undefined>
): LocaleResult {
  // 1. URL prefix
  for (const loc of config.locales) {
    if (pathname === `/${loc}` || pathname.startsWith(`/${loc}/`)) {
      return { locale: loc, pathname: pathname.slice(loc.length + 1) || '/' };
    }
  }

  // 2. Cookie
  const cookieHeader = headers?.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)nk-locale=([^;]+)/);
    if (match && config.locales.includes(match[1])) {
      return { locale: match[1], pathname };
    }
  }

  // 3. Accept-Language
  const acceptLang = headers?.['accept-language'];
  if (typeof acceptLang === 'string') {
    const preferred = parseAcceptLanguage(acceptLang);
    for (const lang of preferred) {
      const short = lang.split('-')[0];
      if (config.locales.includes(short)) {
        return { locale: short, pathname };
      }
      if (config.locales.includes(lang)) {
        return { locale: lang, pathname };
      }
    }
  }

  // 4. Default
  return { locale: config.defaultLocale, pathname };
}

/**
 * Parse the Accept-Language header into a sorted list of language codes.
 */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map(part => {
      const [lang, q] = part.trim().split(';q=');
      return { lang: lang.trim().toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q)
    .map(e => e.lang);
}
