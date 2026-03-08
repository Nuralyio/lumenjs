import { describe, it, expect } from 'vitest';
import { MIME_TYPES, isCompressible, acceptsGzip } from './serve-static.js';

describe('MIME_TYPES', () => {
  it('maps .html to text/html', () => {
    expect(MIME_TYPES['.html']).toBe('text/html; charset=utf-8');
  });

  it('maps .js to application/javascript', () => {
    expect(MIME_TYPES['.js']).toBe('application/javascript; charset=utf-8');
  });

  it('maps .css to text/css', () => {
    expect(MIME_TYPES['.css']).toBe('text/css; charset=utf-8');
  });

  it('maps .json to application/json', () => {
    expect(MIME_TYPES['.json']).toBe('application/json; charset=utf-8');
  });

  it('maps .png to image/png', () => {
    expect(MIME_TYPES['.png']).toBe('image/png');
  });

  it('maps .svg to image/svg+xml', () => {
    expect(MIME_TYPES['.svg']).toBe('image/svg+xml');
  });

  it('maps .woff2 to font/woff2', () => {
    expect(MIME_TYPES['.woff2']).toBe('font/woff2');
  });
});

describe('isCompressible', () => {
  it('returns true for text/html', () => {
    expect(isCompressible('text/html; charset=utf-8')).toBe(true);
  });

  it('returns true for application/javascript', () => {
    expect(isCompressible('application/javascript; charset=utf-8')).toBe(true);
  });

  it('returns true for text/css', () => {
    expect(isCompressible('text/css; charset=utf-8')).toBe(true);
  });

  it('returns true for image/svg+xml', () => {
    expect(isCompressible('image/svg+xml')).toBe(true);
  });

  it('returns false for image/png', () => {
    expect(isCompressible('image/png')).toBe(false);
  });

  it('returns false for image/jpeg', () => {
    expect(isCompressible('image/jpeg')).toBe(false);
  });

  it('returns false for font/woff2', () => {
    expect(isCompressible('font/woff2')).toBe(false);
  });
});

describe('acceptsGzip', () => {
  it('returns true when accept-encoding includes gzip', () => {
    const req = { headers: { 'accept-encoding': 'gzip, deflate, br' } } as any;
    expect(acceptsGzip(req)).toBe(true);
  });

  it('returns false when accept-encoding is missing', () => {
    const req = { headers: {} } as any;
    expect(acceptsGzip(req)).toBe(false);
  });

  it('returns false when accept-encoding does not include gzip', () => {
    const req = { headers: { 'accept-encoding': 'deflate, br' } } as any;
    expect(acceptsGzip(req)).toBe(false);
  });
});
