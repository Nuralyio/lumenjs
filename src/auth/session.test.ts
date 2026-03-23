import { describe, it, expect } from 'vitest';
import {
  encryptSession,
  decryptSession,
  createSessionCookie,
  clearSessionCookie,
  parseSessionCookie,
  shouldRefreshSession,
} from './session.js';
import type { SessionData } from './types.js';

const SECRET = 'test-secret-key-for-lumenjs-auth';

const mockSession: SessionData = {
  accessToken: 'access123',
  refreshToken: 'refresh456',
  idToken: 'id789',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  user: { sub: 'user-1', email: 'test@example.com', roles: ['admin'] },
};

describe('session', () => {
  describe('encrypt/decrypt roundtrip', () => {
    it('encrypts and decrypts session data', async () => {
      const encrypted = await encryptSession(mockSession, SECRET);
      expect(typeof encrypted).toBe('string');
      expect(encrypted).toContain('.');

      const decrypted = await decryptSession(encrypted, SECRET);
      expect(decrypted).not.toBeNull();
      expect(decrypted!.accessToken).toBe('access123');
      expect(decrypted!.user.sub).toBe('user-1');
      expect(decrypted!.user.email).toBe('test@example.com');
    });

    it('returns null for invalid cookie', async () => {
      const result = await decryptSession('invalid.cookie.data', SECRET);
      expect(result).toBeNull();
    });

    it('returns null for wrong secret', async () => {
      const encrypted = await encryptSession(mockSession, SECRET);
      const result = await decryptSession(encrypted, 'wrong-secret');
      expect(result).toBeNull();
    });

    it('returns null for empty string', async () => {
      const result = await decryptSession('', SECRET);
      expect(result).toBeNull();
    });
  });

  describe('createSessionCookie', () => {
    it('creates a cookie with HttpOnly and SameSite', () => {
      const cookie = createSessionCookie('nk-session', 'value123', 3600, false);
      expect(cookie).toContain('nk-session=value123');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Max-Age=3600');
      expect(cookie).not.toContain('Secure');
    });

    it('includes Secure flag when secure=true', () => {
      const cookie = createSessionCookie('nk-session', 'value', 3600, true);
      expect(cookie).toContain('Secure');
    });
  });

  describe('clearSessionCookie', () => {
    it('creates a cookie with Max-Age=0', () => {
      const cookie = clearSessionCookie('nk-session');
      expect(cookie).toContain('nk-session=');
      expect(cookie).toContain('Max-Age=0');
    });
  });

  describe('parseSessionCookie', () => {
    it('extracts named cookie from header', () => {
      const value = parseSessionCookie('nk-session=abc123; other=xyz', 'nk-session');
      expect(value).toBe('abc123');
    });

    it('returns undefined for missing cookie', () => {
      const value = parseSessionCookie('other=xyz', 'nk-session');
      expect(value).toBeUndefined();
    });

    it('handles cookie at start of header', () => {
      const value = parseSessionCookie('nk-session=first', 'nk-session');
      expect(value).toBe('first');
    });
  });

  describe('shouldRefreshSession', () => {
    it('returns true when session expires within 5 minutes', () => {
      const session = { ...mockSession, expiresAt: Math.floor(Date.now() / 1000) + 120 };
      expect(shouldRefreshSession(session)).toBe(true);
    });

    it('returns false when session has plenty of time', () => {
      const session = { ...mockSession, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
      expect(shouldRefreshSession(session)).toBe(false);
    });
  });
});
