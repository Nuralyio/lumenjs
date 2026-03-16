/**
 * LumenJS i18n runtime — provides translation lookup, locale management,
 * and translation loading for both SSR and client-side navigation.
 */

let currentLocale = 'en';
let translations: Record<string, string> = {};
let i18nConfig: { locales: string[]; defaultLocale: string; prefixDefault: boolean } | null = null;

/**
 * Look up a translation key. Returns the translated string, or the key itself
 * if no translation is found.
 */
export function t(key: string): string {
  return translations[key] ?? key;
}

/** Returns the current locale. */
export function getLocale(): string {
  return currentLocale;
}

/** Returns the i18n config, or null if i18n is not enabled. */
export function getI18nConfig(): { locales: string[]; defaultLocale: string; prefixDefault: boolean } | null {
  return i18nConfig;
}

/**
 * Switch to a new locale. Navigates to the same pathname under the new
 * locale prefix and sets the `nk-locale` cookie.
 */
export function setLocale(locale: string): void {
  if (!i18nConfig || !i18nConfig.locales.includes(locale)) return;

  document.cookie = `nk-locale=${locale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;

  const pathname = stripLocalePrefix(location.pathname);
  const newPath = buildLocalePath(locale, pathname);
  location.href = newPath;
}

/**
 * Initialise the i18n runtime with config and translations.
 * Called during hydration (from SSR data) or on first load.
 */
export function initI18n(
  config: { locales: string[]; defaultLocale: string; prefixDefault: boolean },
  locale: string,
  trans: Record<string, string>
): void {
  i18nConfig = config;
  currentLocale = locale;
  translations = trans;
}

/**
 * Load translations for a locale from the server and swap them in.
 * Used during client-side locale switches and HMR updates.
 */
export async function loadTranslations(locale: string): Promise<void> {
  const res = await fetch(`/__nk_i18n/${locale}.json`);
  if (!res.ok) {
    console.error(`[i18n] Failed to load translations for locale "${locale}"`);
    return;
  }
  translations = await res.json();
  currentLocale = locale;
}

/**
 * Register the HMR reload handler on the global scope.
 * The i18n Vite plugin injects an inline script that calls this function
 * when a locale file changes — ensuring translations are updated in this
 * module instance (not a duplicate created by Vite's cache-busting).
 */
if (typeof window !== 'undefined') {
  (window as any).__lumenjs_i18n_reload = async (locale: string): Promise<boolean> => {
    if (locale !== currentLocale) return false;
    await loadTranslations(locale);
    return true;
  };
}

/**
 * Strip the locale prefix from a pathname.
 *   /fr/about → /about
 *   /about    → /about
 */
export function stripLocalePrefix(pathname: string): string {
  if (!i18nConfig) return pathname;
  for (const loc of i18nConfig.locales) {
    if (loc === i18nConfig.defaultLocale && !i18nConfig.prefixDefault) continue;
    if (pathname === `/${loc}` || pathname.startsWith(`/${loc}/`)) {
      return pathname.slice(loc.length + 1) || '/';
    }
  }
  return pathname;
}

/**
 * Prepend the locale prefix to a pathname.
 *   (fr, /about) → /fr/about
 *   (en, /about) → /about        (when prefixDefault=false)
 */
export function buildLocalePath(locale: string, pathname: string): string {
  if (!i18nConfig) return pathname;
  if (locale === i18nConfig.defaultLocale && !i18nConfig.prefixDefault) {
    return pathname;
  }
  return `/${locale}${pathname === '/' ? '' : pathname}` || `/${locale}`;
}

/**
 * Detect the locale from a URL pathname.
 * Returns the locale and the pathname with the prefix stripped.
 */
export function detectLocaleFromPath(pathname: string): { locale: string; pathname: string } {
  if (!i18nConfig) return { locale: 'en', pathname };
  for (const loc of i18nConfig.locales) {
    if (pathname === `/${loc}` || pathname.startsWith(`/${loc}/`)) {
      return { locale: loc, pathname: pathname.slice(loc.length + 1) || '/' };
    }
  }
  return { locale: i18nConfig.defaultLocale, pathname };
}
