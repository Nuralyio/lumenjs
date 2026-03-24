import { describe, it, expect } from 'vitest';
import { extractUrls } from './link-preview.js';

describe('link-preview', () => {
  describe('extractUrls', () => {
    it('extracts URLs from text', () => {
      const urls = extractUrls('Check out https://example.com and http://test.org/page');
      expect(urls).toEqual(['https://example.com', 'http://test.org/page']);
    });

    it('returns empty for no URLs', () => {
      expect(extractUrls('No links here')).toEqual([]);
    });

    it('deduplicates URLs', () => {
      const urls = extractUrls('https://x.com and https://x.com again');
      expect(urls).toEqual(['https://x.com']);
    });

    it('limits to 3 URLs', () => {
      const urls = extractUrls('https://a.com https://b.com https://c.com https://d.com');
      expect(urls.length).toBe(3);
    });

    it('handles URLs with paths and params', () => {
      const urls = extractUrls('See https://example.com/path?q=1&r=2#hash');
      expect(urls[0]).toBe('https://example.com/path?q=1&r=2#hash');
    });
  });
});
