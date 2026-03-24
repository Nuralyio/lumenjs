import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateVerificationToken,
  verifyVerificationToken,
  generateResetToken,
  verifyResetToken,
} from './native-auth.js';

const SECRET = 'test-secret-for-native-auth';

describe('native-auth', () => {
  describe('password hashing', () => {
    it('hashes and verifies a password', async () => {
      const hash = await hashPassword('mypassword123');
      expect(typeof hash).toBe('string');
      expect(hash).toContain(':');

      const valid = await verifyPassword('mypassword123', hash);
      expect(valid).toBe(true);
    });

    it('rejects wrong password', async () => {
      const hash = await hashPassword('correct-password');
      const valid = await verifyPassword('wrong-password', hash);
      expect(valid).toBe(false);
    });

    it('produces different hashes for same password (random salt)', async () => {
      const hash1 = await hashPassword('same-password');
      const hash2 = await hashPassword('same-password');
      expect(hash1).not.toBe(hash2);

      expect(await verifyPassword('same-password', hash1)).toBe(true);
      expect(await verifyPassword('same-password', hash2)).toBe(true);
    });

    it('returns false for malformed hash', async () => {
      const valid = await verifyPassword('password', 'not-a-valid-hash');
      expect(valid).toBe(false);
    });
  });

  describe('email verification tokens', () => {
    it('generates and verifies a token', () => {
      const token = generateVerificationToken('user-123', SECRET, 3600);
      expect(typeof token).toBe('string');
      expect(token).toContain('.');

      const userId = verifyVerificationToken(token, SECRET);
      expect(userId).toBe('user-123');
    });

    it('rejects token with wrong secret', () => {
      const token = generateVerificationToken('user-123', SECRET, 3600);
      expect(verifyVerificationToken(token, 'wrong-secret')).toBeNull();
    });

    it('rejects expired token', () => {
      const token = generateVerificationToken('user-123', SECRET, -1);
      expect(verifyVerificationToken(token, SECRET)).toBeNull();
    });

    it('rejects malformed token', () => {
      expect(verifyVerificationToken('garbage', SECRET)).toBeNull();
      expect(verifyVerificationToken('', SECRET)).toBeNull();
    });
  });

  describe('password reset tokens', () => {
    it('generates and verifies a reset token', () => {
      const token = generateResetToken('user-456', SECRET, 3600);
      const userId = verifyResetToken(token, SECRET);
      expect(userId).toBe('user-456');
    });

    it('rejects expired reset token', () => {
      const token = generateResetToken('user-456', SECRET, -1);
      expect(verifyResetToken(token, SECRET)).toBeNull();
    });
  });
});
