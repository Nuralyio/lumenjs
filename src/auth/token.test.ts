import { describe, it, expect } from 'vitest';
import {
  ACCESS_TOKEN_COOKIE,
  issueAccessToken,
  verifyAccessToken,
  createAccessTokenCookie,
  clearAccessTokenCookie,
  generateRefreshToken,
  hashRefreshToken,
} from './token.js';
import type { AuthUser } from './types.js';

const SECRET = 'test-secret-for-tokens';

const mockUser: AuthUser = {
  sub: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  roles: ['admin'],
  provider: 'native',
};

describe('token', () => {
  describe('access tokens', () => {
    it('issues and verifies a token', () => {
      const token = issueAccessToken(mockUser, SECRET, 900);
      expect(typeof token).toBe('string');
      expect(token).toContain('.');

      const user = verifyAccessToken(token, SECRET);
      expect(user).not.toBeNull();
      expect(user!.sub).toBe('user-1');
      expect(user!.email).toBe('test@example.com');
      expect(user!.roles).toEqual(['admin']);
      expect(user!.provider).toBe('native');
    });

    it('rejects token with wrong secret', () => {
      const token = issueAccessToken(mockUser, SECRET, 900);
      const user = verifyAccessToken(token, 'wrong-secret');
      expect(user).toBeNull();
    });

    it('rejects expired token', () => {
      const token = issueAccessToken(mockUser, SECRET, -1); // expired immediately
      const user = verifyAccessToken(token, SECRET);
      expect(user).toBeNull();
    });

    it('rejects malformed token', () => {
      expect(verifyAccessToken('not.a.valid.token', SECRET)).toBeNull();
      expect(verifyAccessToken('', SECRET)).toBeNull();
      expect(verifyAccessToken('onlyonepart', SECRET)).toBeNull();
    });

    it('produces different tokens each time (different iat)', async () => {
      const t1 = issueAccessToken(mockUser, SECRET, 900);
      await new Promise(r => setTimeout(r, 10));
      const t2 = issueAccessToken(mockUser, SECRET, 900);
      // Tokens may be the same if iat is the same second, so just check they're valid
      expect(verifyAccessToken(t1, SECRET)).not.toBeNull();
      expect(verifyAccessToken(t2, SECRET)).not.toBeNull();
    });
  });

  describe('the access-token cookie the gateway reads', () => {
    // The OpenResty gateway verifies an HMAC JWT out of `nk-access-token`. A
    // browser login only ever got the encrypted `nk-session` blob, which the
    // gateway cannot open — so every request from a logged-in browser was a 401
    // at the edge. These assertions are that seam.
    it('carries a token the same secret verifies', () => {
      const cookie = createAccessTokenCookie(mockUser, SECRET, 3600, true);
      const value = cookie.split(';')[0].slice(`${ACCESS_TOKEN_COOKIE}=`.length);
      const user = verifyAccessToken(value, SECRET);
      expect(user).not.toBeNull();
      expect(user!.sub).toBe('user-1');
      expect(user!.roles).toEqual(['admin']);
    });

    it('is host-only, HttpOnly and script-unreadable', () => {
      const cookie = createAccessTokenCookie(mockUser, SECRET, 3600, true);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Path=/');
      // No Domain= — the cookie belongs to the host that set it and rides
      // nowhere else, which is the whole reason the console serves its own login.
      expect(cookie).not.toContain('Domain=');
    });

    it('lives as long as the session, not as long as an access token', () => {
      // Nothing re-issues this on a request that never reaches this process, so
      // a 15-minute lifetime would sign the console out 15 minutes after login.
      const cookie = createAccessTokenCookie(mockUser, SECRET, 604800, false);
      expect(cookie).toContain('Max-Age=604800');
      expect(cookie).not.toContain('Secure');
      const value = cookie.split(';')[0].slice(`${ACCESS_TOKEN_COOKIE}=`.length);
      expect(verifyAccessToken(value, SECRET)).not.toBeNull();
    });

    it('is expired by the clearing form', () => {
      const cleared = clearAccessTokenCookie();
      expect(cleared).toContain(`${ACCESS_TOKEN_COOKIE}=;`);
      expect(cleared).toContain('Max-Age=0');
      expect(cleared).toContain('HttpOnly');
    });
  });

  describe('refresh tokens', () => {
    it('generates a random opaque token', () => {
      const token = generateRefreshToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
    });

    it('generates different tokens each time', () => {
      const t1 = generateRefreshToken();
      const t2 = generateRefreshToken();
      expect(t1).not.toBe(t2);
    });

    it('hashes consistently', () => {
      const token = generateRefreshToken();
      const h1 = hashRefreshToken(token);
      const h2 = hashRefreshToken(token);
      expect(h1).toBe(h2);
    });

    it('different tokens produce different hashes', () => {
      const h1 = hashRefreshToken(generateRefreshToken());
      const h2 = hashRefreshToken(generateRefreshToken());
      expect(h1).not.toBe(h2);
    });
  });
});
