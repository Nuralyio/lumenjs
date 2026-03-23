import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  decodeJwtPayload,
  extractUser,
} from './oidc-client.js';

describe('oidc-client', () => {
  describe('PKCE', () => {
    it('generates a code verifier of correct length', () => {
      const verifier = generateCodeVerifier();
      expect(typeof verifier).toBe('string');
      expect(verifier.length).toBeGreaterThan(20);
    });

    it('generates different verifiers each time', () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });

    it('generates a code challenge from verifier', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(typeof challenge).toBe('string');
      expect(challenge.length).toBeGreaterThan(20);
      // Challenge should be different from verifier (it's a hash)
      expect(challenge).not.toBe(verifier);
    });

    it('same verifier produces same challenge', () => {
      const verifier = generateCodeVerifier();
      const c1 = generateCodeChallenge(verifier);
      const c2 = generateCodeChallenge(verifier);
      expect(c1).toBe(c2);
    });
  });

  describe('decodeJwtPayload', () => {
    it('decodes a JWT payload', () => {
      // Create a fake JWT: header.payload.signature
      const payload = { sub: 'user-1', email: 'test@test.com', name: 'Test User' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${encoded}.fakesignature`;

      const decoded = decodeJwtPayload(fakeJwt);
      expect(decoded.sub).toBe('user-1');
      expect(decoded.email).toBe('test@test.com');
    });

    it('throws for invalid JWT', () => {
      expect(() => decodeJwtPayload('not-a-jwt')).toThrow('Invalid JWT');
    });
  });

  describe('extractUser', () => {
    it('extracts user from id_token with Keycloak realm_access roles', () => {
      const payload = {
        sub: 'kc-user-1',
        email: 'admin@company.com',
        name: 'Admin User',
        preferred_username: 'admin',
        realm_access: { roles: ['admin', 'user'] },
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `eyJhbGciOiJSUzI1NiJ9.${encoded}.sig`;

      const user = extractUser(token);
      expect(user.sub).toBe('kc-user-1');
      expect(user.email).toBe('admin@company.com');
      expect(user.roles).toEqual(['admin', 'user']);
    });

    it('extracts user with generic roles claim', () => {
      const payload = {
        sub: 'generic-user',
        email: 'user@example.com',
        roles: ['editor'],
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `eyJhbGciOiJSUzI1NiJ9.${encoded}.sig`;

      const user = extractUser(token);
      expect(user.roles).toEqual(['editor']);
    });

    it('defaults to empty roles when none present', () => {
      const payload = { sub: 'no-roles-user', email: 'user@test.com' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `eyJhbGciOiJSUzI1NiJ9.${encoded}.sig`;

      const user = extractUser(token);
      expect(user.roles).toEqual([]);
    });
  });
});
