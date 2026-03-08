import { describe, it, expect, beforeEach } from 'vitest';
import {
  t,
  getLocale,
  getI18nConfig,
  initI18n,
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
});
