import { describe, it, expect, vi } from 'vitest';
import { createSecurityHeadersMiddleware } from './security-headers.js';

function createMockRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader: vi.fn((key: string, val: string) => { headers[key] = val; }),
    _headers: headers,
  };
}

describe('security-headers', () => {
  it('sets all default security headers', () => {
    const mw = createSecurityHeadersMiddleware();
    const res = createMockRes();
    const next = vi.fn();

    mw({} as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(res._headers['X-Frame-Options']).toBe('DENY');
    expect(res._headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res._headers['Strict-Transport-Security']).toContain('max-age=');
    expect(res._headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(res._headers['Permissions-Policy']).toContain('camera=()');
    expect(res._headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('allows disabling individual headers', () => {
    const mw = createSecurityHeadersMiddleware({
      frameOptions: false,
      hsts: false,
    });
    const res = createMockRes();
    const next = vi.fn();

    mw({} as any, res as any, next);

    expect(res._headers['X-Frame-Options']).toBeUndefined();
    expect(res._headers['Strict-Transport-Security']).toBeUndefined();
    expect(res._headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('allows custom CSP', () => {
    const customCSP = "default-src 'none'; script-src 'self'";
    const mw = createSecurityHeadersMiddleware({ contentSecurityPolicy: customCSP });
    const res = createMockRes();
    const next = vi.fn();

    mw({} as any, res as any, next);

    expect(res._headers['Content-Security-Policy']).toBe(customCSP);
  });

  it('allows SAMEORIGIN frame option', () => {
    const mw = createSecurityHeadersMiddleware({ frameOptions: 'SAMEORIGIN' });
    const res = createMockRes();
    const next = vi.fn();

    mw({} as any, res as any, next);

    expect(res._headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });
});
