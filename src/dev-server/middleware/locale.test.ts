import { describe, it, expect } from 'vitest';
import { resolveLocale } from './locale.js';

const config = {
  locales: ['en', 'fr', 'de'],
  defaultLocale: 'en',
  prefixDefault: false,
};

describe('resolveLocale', () => {
  it('extracts locale from URL prefix /fr/about', () => {
    const result = resolveLocale('/fr/about', config);
    expect(result.locale).toBe('fr');
    expect(result.pathname).toBe('/about');
  });

  it('handles URL prefix /fr alone', () => {
    const result = resolveLocale('/fr', config);
    expect(result.locale).toBe('fr');
    expect(result.pathname).toBe('/');
  });

  it('extracts locale /de/settings/profile', () => {
    const result = resolveLocale('/de/settings/profile', config);
    expect(result.locale).toBe('de');
    expect(result.pathname).toBe('/settings/profile');
  });

  it('reads locale from cookie', () => {
    const result = resolveLocale('/about', config, {
      cookie: 'nk-locale=fr',
    });
    expect(result.locale).toBe('fr');
    expect(result.pathname).toBe('/about');
  });

  it('reads locale from cookie with other cookies', () => {
    const result = resolveLocale('/about', config, {
      cookie: 'session=abc; nk-locale=de; theme=dark',
    });
    expect(result.locale).toBe('de');
  });

  it('ignores cookie with unknown locale', () => {
    const result = resolveLocale('/about', config, {
      cookie: 'nk-locale=ja',
    });
    expect(result.locale).toBe('en');
  });

  it('parses Accept-Language header', () => {
    const result = resolveLocale('/about', config, {
      'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
    });
    expect(result.locale).toBe('de');
  });

  it('sorts Accept-Language by quality', () => {
    const result = resolveLocale('/about', config, {
      'accept-language': 'en;q=0.5,fr;q=0.9',
    });
    expect(result.locale).toBe('fr');
  });

  it('falls back to default locale', () => {
    const result = resolveLocale('/about', config);
    expect(result.locale).toBe('en');
    expect(result.pathname).toBe('/about');
  });

  it('URL prefix takes priority over cookie', () => {
    const result = resolveLocale('/de/page', config, {
      cookie: 'nk-locale=fr',
    });
    expect(result.locale).toBe('de');
  });

  it('cookie takes priority over Accept-Language', () => {
    const result = resolveLocale('/page', config, {
      cookie: 'nk-locale=fr',
      'accept-language': 'de',
    });
    expect(result.locale).toBe('fr');
  });
});
