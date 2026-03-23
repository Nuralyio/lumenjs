import { describe, it, expect } from 'vitest';
import { enforceGuard } from './guard.js';
import type { NkAuth } from './types.js';

const mockAuth: NkAuth = {
  user: { sub: 'user-1', email: 'test@test.com', roles: ['admin', 'editor'] },
  session: { accessToken: 'tok', expiresAt: 99999999999, user: { sub: 'user-1', roles: ['admin', 'editor'] } },
};

const loginUrl = '/__nk_auth/login';

describe('enforceGuard', () => {
  it('allows when auth is falsy', () => {
    expect(enforceGuard(null, null, loginUrl, '/page')).toEqual({ allowed: true });
    expect(enforceGuard(undefined, null, loginUrl, '/page')).toEqual({ allowed: true });
    expect(enforceGuard(false, null, loginUrl, '/page')).toEqual({ allowed: true });
  });

  it('redirects when auth=true and no user', () => {
    const result = enforceGuard(true, null, loginUrl, '/dashboard');
    expect(result).toEqual({ redirect: '/__nk_auth/login?returnTo=%2Fdashboard' });
  });

  it('allows when auth=true and user exists', () => {
    expect(enforceGuard(true, mockAuth, loginUrl, '/dashboard')).toEqual({ allowed: true });
  });

  it('redirects when roles required and no user', () => {
    const result = enforceGuard({ roles: ['admin'] }, null, loginUrl, '/admin');
    expect(result).toEqual({ redirect: '/__nk_auth/login?returnTo=%2Fadmin' });
  });

  it('allows when user has required role', () => {
    expect(enforceGuard({ roles: ['admin'] }, mockAuth, loginUrl, '/admin')).toEqual({ allowed: true });
  });

  it('allows when user has any of the required roles', () => {
    expect(enforceGuard({ roles: ['viewer', 'editor'] }, mockAuth, loginUrl, '/page')).toEqual({ allowed: true });
  });

  it('returns forbidden when user lacks required role', () => {
    expect(enforceGuard({ roles: ['superadmin'] }, mockAuth, loginUrl, '/page')).toEqual({ forbidden: true });
  });
});
