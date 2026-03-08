import { describe, it, expect } from 'vitest';
import { redirect } from './response.js';

describe('redirect', () => {
  it('returns object with __nk_redirect flag', () => {
    const result = redirect('/login');
    expect(result.__nk_redirect).toBe(true);
  });

  it('includes location', () => {
    const result = redirect('/login');
    expect(result.location).toBe('/login');
  });

  it('defaults to status 302', () => {
    const result = redirect('/login');
    expect(result.status).toBe(302);
  });

  it('accepts custom status', () => {
    const result = redirect('/permanent', 301);
    expect(result.status).toBe(301);
  });
});
