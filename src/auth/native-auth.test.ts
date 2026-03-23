import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './native-auth.js';

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

      // Both should still verify
      expect(await verifyPassword('same-password', hash1)).toBe(true);
      expect(await verifyPassword('same-password', hash2)).toBe(true);
    });

    it('returns false for malformed hash', async () => {
      const valid = await verifyPassword('password', 'not-a-valid-hash');
      expect(valid).toBe(false);
    });
  });
});
