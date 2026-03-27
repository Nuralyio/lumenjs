/**
 * LumenJS i18n runtime — provides translation lookup, locale management,
 * and translation loading for both SSR and client-side navigation.
 *
 * State is stored on globalThis so that it survives Vite's SSR module
 * invalidation. During dev SSR, page and layout modules may each get a
 * separate copy of this module after cache invalidation — globalThis
 * ensures they all read from the same translation map.
 */

interface I18nState {
  locale: string;
  translations: Record<string, string>;
  config: { locales: string[]; defaultLocale: string; prefixDefault: boolean } | null;
}

const G = globalThis as any;
if (!G.__nk_i18n) {
  G.__nk_i18n = { locale: 'en', translations: {}, config: null } as I18nState;
}
const state: I18nState = G.__nk_i18n;

/**
 * Look up a translation key. Returns the translated string, or the key itself
 * if no translation is found.
 */
export function t(key: string): string {
  return state.translations[key] ?? key;
}

/** Returns the current locale. */
export function getLocale(): string {
  return state.locale;
}

/** Returns the i18n config, or null if i18n is not enabled. */
export function getI18nConfig(): { locales: string[]; defaultLocale: string; prefixDefault: boolean } | null {
  return state.config;
}

/**
 * Switch to a new locale. Navigates to the same pathname under the new
 * locale prefix and sets the `nk-locale` cookie.
 */
export function setLocale(locale: string): void {
  if (!state.config || !state.config.locales.includes(locale)) return;

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
  state.config = config;
  state.locale = locale;
  state.translations = trans;
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
  state.translations = await res.json();
  state.locale = locale;
}

/**
 * Register the HMR reload handler on the global scope.
 * The i18n Vite plugin injects an inline script that calls this function
 * when a locale file changes — ensuring translations are updated in this
 * module instance (not a duplicate created by Vite's cache-busting).
 */
if (typeof window !== 'undefined') {
  (window as any).__lumenjs_i18n_reload = async (locale: string): Promise<boolean> => {
    if (locale !== state.locale) return false;
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
  if (!state.config) return pathname;
  for (const loc of state.config.locales) {
    if (loc === state.config.defaultLocale && !state.config.prefixDefault) continue;
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
  if (!state.config) return pathname;
  if (locale === state.config.defaultLocale && !state.config.prefixDefault) {
    return pathname;
  }
  return `/${locale}${pathname === '/' ? '' : pathname}` || `/${locale}`;
}

/**
 * Detect the locale from a URL pathname.
 * Returns the locale and the pathname with the prefix stripped.
 */
export function detectLocaleFromPath(pathname: string): { locale: string; pathname: string } {
  if (!state.config) return { locale: 'en', pathname };
  for (const loc of state.config.locales) {
    if (pathname === `/${loc}` || pathname.startsWith(`/${loc}/`)) {
      return { locale: loc, pathname: pathname.slice(loc.length + 1) || '/' };
    }
  }
  return { locale: state.config.defaultLocale, pathname };
}
