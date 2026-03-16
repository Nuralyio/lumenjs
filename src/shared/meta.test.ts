import { describe, it, expect } from 'vitest';
import { generateMetaTags, computeTitle } from './meta.js';

describe('generateMetaTags', () => {
  it('should generate all tags when all fields populated', () => {
    const result = generateMetaTags(
      {
        title: 'Hello World',
        description: 'A test page',
        image: 'https://example.com/img.jpg',
        canonical: 'https://example.com/hello',
        robots: 'noindex, nofollow',
        type: 'article',
      },
      { siteTitle: 'My Blog', url: '/hello', locale: 'en' }
    );
    expect(result).toContain('<meta property="og:type" content="article">');
    expect(result).toContain('<meta name="description" content="A test page">');
    expect(result).toContain('<meta property="og:description" content="A test page">');
    expect(result).toContain('<meta property="og:title" content="Hello World | My Blog">');
    expect(result).toContain('<meta property="og:image" content="https://example.com/img.jpg">');
    expect(result).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(result).toContain('<meta name="twitter:image" content="https://example.com/img.jpg">');
    expect(result).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(result).toContain('<meta property="og:url" content="/hello">');
    expect(result).toContain('<meta property="og:locale" content="en">');
    expect(result).toContain('<link rel="canonical" href="https://example.com/hello">');
  });

  it('should generate only og:type and og:title when only title provided', () => {
    const result = generateMetaTags({ title: 'Just a Title' }, { siteTitle: 'Site' });
    expect(result).toContain('<meta property="og:type" content="website">');
    expect(result).toContain('<meta property="og:title" content="Just a Title | Site">');
    expect(result).not.toContain('description');
    expect(result).not.toContain('twitter:card');
    expect(result).not.toContain('og:image');
  });

  it('should generate twitter:card when image provided', () => {
    const result = generateMetaTags({ image: 'https://example.com/cover.png' });
    expect(result).toContain('<meta property="og:image" content="https://example.com/cover.png">');
    expect(result).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(result).toContain('<meta name="twitter:image" content="https://example.com/cover.png">');
  });

  it('should generate og:type even with no fields', () => {
    const result = generateMetaTags({});
    expect(result).toContain('<meta property="og:type" content="website">');
    expect(result).not.toContain('description');
    expect(result).not.toContain('og:title');
  });

  it('should generate hreflang tags with i18n config', () => {
    const result = generateMetaTags({}, {
      url: '/blog/hello',
      i18nConfig: { locales: ['en', 'fr'], defaultLocale: 'en', prefixDefault: false },
    });
    expect(result).toContain('<link rel="alternate" hreflang="en" href="/blog/hello">');
    expect(result).toContain('<link rel="alternate" hreflang="fr" href="/fr/blog/hello">');
    expect(result).toContain('<link rel="alternate" hreflang="x-default" href="/blog/hello">');
  });

  it('should generate hreflang with prefixDefault: true', () => {
    const result = generateMetaTags({}, {
      url: '/about',
      i18nConfig: { locales: ['en', 'fr'], defaultLocale: 'en', prefixDefault: true },
    });
    expect(result).toContain('<link rel="alternate" hreflang="en" href="/en/about">');
    expect(result).toContain('<link rel="alternate" hreflang="fr" href="/fr/about">');
    expect(result).toContain('<link rel="alternate" hreflang="x-default" href="/en/about">');
  });

  it('should use url as canonical when canonical not specified', () => {
    const result = generateMetaTags({}, { url: '/about' });
    expect(result).toContain('<link rel="canonical" href="/about">');
  });

  it('should prefer explicit canonical over url', () => {
    const result = generateMetaTags(
      { canonical: 'https://example.com/about' },
      { url: '/about' }
    );
    expect(result).toContain('<link rel="canonical" href="https://example.com/about">');
    expect(result).not.toContain('<link rel="canonical" href="/about">');
  });

  it('should escape HTML in meta values', () => {
    const result = generateMetaTags({
      title: 'Hello <script>alert(1)</script>',
      description: 'Test "quotes" & <tags>',
    });
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&quot;quotes&quot;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;tags&gt;');
  });

  it('should handle root path in hreflang', () => {
    const result = generateMetaTags({}, {
      url: '/',
      i18nConfig: { locales: ['en', 'fr'], defaultLocale: 'en', prefixDefault: false },
    });
    expect(result).toContain('<link rel="alternate" hreflang="en" href="/">');
    expect(result).toContain('<link rel="alternate" hreflang="fr" href="/fr">');
    expect(result).toContain('<link rel="alternate" hreflang="x-default" href="/">');
  });
});

describe('computeTitle', () => {
  it('should format title with site title', () => {
    expect(computeTitle({ title: 'Hello' }, 'My Blog')).toBe('Hello | My Blog');
  });

  it('should return site title when no meta title', () => {
    expect(computeTitle(undefined, 'My Blog')).toBe('My Blog');
    expect(computeTitle({}, 'My Blog')).toBe('My Blog');
  });
});
