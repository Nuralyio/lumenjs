import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  t,
  getLocale,
  getI18nConfig,
  initI18n,
  setLocale,
  loadTranslations,
  stripLocalePrefix,
  buildLocalePath,
  detectLocaleFromPath,
} from './i18n.js';

const testConfig = {
  locales: ['en', 'fr', 'de'],
  defaultLocale: 'en',
  prefixDefault: false,
};

describe('i18n runtime', () => {
  beforeEach(() => {
    // Reset state by re-initializing
    initI18n(testConfig, 'en', { hello: 'Hello', goodbye: 'Goodbye' });
  });

  describe('t()', () => {
    it('returns translation for known key', () => {
      expect(t('hello')).toBe('Hello');
    });

    it('returns key itself for unknown key', () => {
      expect(t('unknown.key')).toBe('unknown.key');
    });
  });

  describe('getLocale()', () => {
    it('returns current locale', () => {
      expect(getLocale()).toBe('en');
    });

    it('returns updated locale after initI18n', () => {
      initI18n(testConfig, 'fr', { hello: 'Bonjour' });
      expect(getLocale()).toBe('fr');
    });
  });

  describe('getI18nConfig()', () => {
    it('returns config after init', () => {
      const config = getI18nConfig();
      expect(config).toEqual(testConfig);
    });
  });

  describe('initI18n()', () => {
    it('sets locale and translations', () => {
      initI18n(testConfig, 'de', { hello: 'Hallo' });
      expect(getLocale()).toBe('de');
      expect(t('hello')).toBe('Hallo');
    });
  });

  describe('stripLocalePrefix()', () => {
    it('strips /fr/ prefix', () => {
      expect(stripLocalePrefix('/fr/about')).toBe('/about');
    });

    it('strips /fr alone', () => {
      expect(stripLocalePrefix('/fr')).toBe('/');
    });

    it('does not strip default locale when prefixDefault is false', () => {
      expect(stripLocalePrefix('/en/about')).toBe('/en/about');
    });

    it('strips default locale when prefixDefault is true', () => {
      initI18n({ ...testConfig, prefixDefault: true }, 'en', {});
      expect(stripLocalePrefix('/en/about')).toBe('/about');
    });

    it('returns pathname unchanged when no prefix matches', () => {
      expect(stripLocalePrefix('/about')).toBe('/about');
    });
  });

  describe('buildLocalePath()', () => {
    it('prepends locale prefix for non-default locale', () => {
      expect(buildLocalePath('fr', '/about')).toBe('/fr/about');
    });

    it('returns bare pathname for default locale when prefixDefault is false', () => {
      expect(buildLocalePath('en', '/about')).toBe('/about');
    });

    it('prepends default locale when prefixDefault is true', () => {
      initI18n({ ...testConfig, prefixDefault: true }, 'en', {});
      expect(buildLocalePath('en', '/about')).toBe('/en/about');
    });

    it('handles root pathname', () => {
      expect(buildLocalePath('fr', '/')).toBe('/fr');
    });
  });

  describe('detectLocaleFromPath()', () => {
    it('detects locale from /fr/about', () => {
      const result = detectLocaleFromPath('/fr/about');
      expect(result.locale).toBe('fr');
      expect(result.pathname).toBe('/about');
    });

    it('detects locale from /de', () => {
      const result = detectLocaleFromPath('/de');
      expect(result.locale).toBe('de');
      expect(result.pathname).toBe('/');
    });

    it('returns default locale for unprefixed path', () => {
      const result = detectLocaleFromPath('/about');
      expect(result.locale).toBe('en');
      expect(result.pathname).toBe('/about');
    });
  });

  describe('setLocale()', () => {
    let cookieSetter: ReturnType<typeof vi.fn>;
    let hrefSetter: ReturnType<typeof vi.fn>;
    let originalDocument: typeof globalThis.document;
    let originalLocation: typeof globalThis.location;

    beforeEach(() => {
      cookieSetter = vi.fn();
      hrefSetter = vi.fn();

      originalDocument = globalThis.document;
      originalLocation = globalThis.location;

      // @ts-ignore – minimal mock for cookie
      globalThis.document = { set cookie(v: string) { cookieSetter(v); } };

      // @ts-ignore – minimal mock for location
      globalThis.location = { pathname: '/fr/about', set href(v: string) { hrefSetter(v); } };
    });

    afterEach(() => {
      globalThis.document = originalDocument;
      globalThis.location = originalLocation;
    });

    it('sets cookie and navigates for a valid non-default locale', () => {
      initI18n(testConfig, 'en', {});
      // location.pathname = /fr/about → stripped to /about → buildLocalePath('fr', '/about') = /fr/about
      setLocale('fr');

      expect(cookieSetter).toHaveBeenCalledWith(
        'nk-locale=fr;path=/;max-age=31536000;SameSite=Lax',
      );
      expect(hrefSetter).toHaveBeenCalledWith('/fr/about');
    });

    it('navigates to bare path for default locale when prefixDefault is false', () => {
      initI18n(testConfig, 'fr', {});
      // @ts-ignore
      globalThis.location = { pathname: '/fr/about', set href(v: string) { hrefSetter(v); } };

      setLocale('en');

      expect(cookieSetter).toHaveBeenCalledWith(
        'nk-locale=en;path=/;max-age=31536000;SameSite=Lax',
      );
      // stripLocalePrefix('/fr/about') → /about, buildLocalePath('en', '/about') → /about (no prefix)
      expect(hrefSetter).toHaveBeenCalledWith('/about');
    });

    it('prefixes default locale when prefixDefault is true', () => {
      initI18n({ ...testConfig, prefixDefault: true }, 'fr', {});
      // @ts-ignore
      globalThis.location = { pathname: '/fr/about', set href(v: string) { hrefSetter(v); } };

      setLocale('en');

      expect(hrefSetter).toHaveBeenCalledWith('/en/about');
    });

    it('does nothing for an unknown locale', () => {
      initI18n(testConfig, 'en', {});
      setLocale('es');

      expect(cookieSetter).not.toHaveBeenCalled();
      expect(hrefSetter).not.toHaveBeenCalled();
    });

    it('does nothing when config is null', () => {
      initI18n(null as any, 'en', {});
      // Restore config to null via the globalThis state hack
      (globalThis as any).__nk_i18n.config = null;

      setLocale('fr');

      expect(cookieSetter).not.toHaveBeenCalled();
      expect(hrefSetter).not.toHaveBeenCalled();
    });
  });

  describe('loadTranslations()', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('fetches translations and updates state on success', async () => {
      const translations = { hello: 'Bonjour', goodbye: 'Au revoir' };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(translations),
      });

      initI18n(testConfig, 'en', { hello: 'Hello' });
      await loadTranslations('fr');

      expect(fetch).toHaveBeenCalledWith('/__nk_i18n/fr.json');
      expect(getLocale()).toBe('fr');
      expect(t('hello')).toBe('Bonjour');
      expect(t('goodbye')).toBe('Au revoir');
    });

    it('logs error and leaves state unchanged on non-200 response', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      initI18n(testConfig, 'en', { hello: 'Hello' });
      await loadTranslations('fr');

      expect(errorSpy).toHaveBeenCalledWith(
        '[i18n] Failed to load translations for locale "fr"',
      );
      // State should be unchanged
      expect(getLocale()).toBe('en');
      expect(t('hello')).toBe('Hello');
      errorSpy.mockRestore();
    });

    it('propagates error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      initI18n(testConfig, 'en', { hello: 'Hello' });
      await expect(loadTranslations('fr')).rejects.toThrow('fetch failed');

      // State should be unchanged
      expect(getLocale()).toBe('en');
      expect(t('hello')).toBe('Hello');
    });

    it('propagates error on malformed JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      initI18n(testConfig, 'en', { hello: 'Hello' });
      await expect(loadTranslations('fr')).rejects.toThrow('Unexpected token');

      // State should be unchanged — locale was not yet updated because
      // the assignment to state.translations threw before state.locale was set
      expect(getLocale()).toBe('en');
    });
  });
});
