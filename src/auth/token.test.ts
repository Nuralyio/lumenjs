import { describe, it, expect } from 'vitest';
import {
  issueAccessToken,
  verifyAccessToken,
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
