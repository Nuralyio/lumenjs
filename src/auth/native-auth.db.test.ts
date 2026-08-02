/**
 * The db-touching half of native-auth, tested for the first time.
 *
 * Every function here was untested before the AuthDb harness existed, and one
 * of them was broken in production: verifyUserEmail, updatePassword and
 * revokeAllSessions wrote datetime("now") — double quotes — which SQLite
 * accepts as a string-literal fallback and the Postgres translator does not
 * convert at all, so logout-all, verification and password change threw on
 * every Postgres deployment. These tests are the regression fence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db.js';
import {
  ensureUsersTable,
  registerUser,
  authenticateUser,
  findUserByEmail,
  verifyUserEmail,
  updatePassword,
  revokeAllSessions,
  linkOidcUser,
} from './native-auth.js';

let db: ReturnType<typeof createTestDb>;

beforeEach(async () => {
  db = createTestDb();
  await ensureUsersTable(db);
});

afterEach(() => db.close());

describe('ensureUsersTable on SQLite', () => {
  it('creates a table a row can actually be inserted into', async () => {
    // The old DDL (DEFAULT NOW()) was a SQLite syntax error thrown here, on
    // the very first signup.
    const user = await registerUser(db, 'a@b.co', 'password-123', 'Ada', 'local');
    expect(user.email).toBe('a@b.co');
    const row = await db.get('SELECT created_at FROM _nk_auth_users WHERE email = ?', 'a@b.co');
    expect(row.created_at).toBeTruthy();
  });

  it('is idempotent', async () => {
    await ensureUsersTable(db);
    await ensureUsersTable(db);
  });
});

describe('the datetime("now") regression', () => {
  it('verifyUserEmail writes a real timestamp, not the string "now"', async () => {
    const user = await registerUser(db, 'v@b.co', 'password-123', null, 'local');
    expect(await verifyUserEmail(db, user.sub)).toBe(true);
    const row = await db.get('SELECT updated_at, email_verified FROM _nk_auth_users WHERE id = ?', user.sub);
    expect(row.email_verified).toBe(1);
    // With double quotes SQLite stored the LITERAL text "now" — the fallback
    // that made the bug invisible on laptops while Postgres threw.
    expect(row.updated_at).not.toBe('now');
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('updatePassword and revokeAllSessions write timestamps too', async () => {
    const user = await registerUser(db, 'p@b.co', 'password-123', null, 'local');
    await updatePassword(db, user.sub, 'password-456');
    await revokeAllSessions(db, user.sub);
    const row = await db.get('SELECT updated_at, sessions_revoked_at FROM _nk_auth_users WHERE id = ?', user.sub);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(row.sessions_revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // And the new password is the one that authenticates.
    expect(await authenticateUser(db, 'p@b.co', 'password-456')).not.toBeNull();
    expect(await authenticateUser(db, 'p@b.co', 'password-123')).toBeNull();
  });
});

describe('linkOidcUser', () => {
  it('never links an unverified email to an existing account', async () => {
    await registerUser(db, 'victim@b.co', 'password-123', null, 'local');
    const before = await findUserByEmail(db, 'victim@b.co');
    const out = await linkOidcUser(db, {
      sub: 'idp-sub-1', email: 'victim@b.co', roles: [], email_verified: false, provider: 'evilidp',
    } as any);
    // The session keeps the IdP subject — it does NOT become the local user.
    expect(out.sub).toBe('idp-sub-1');
    expect(before!.sub).not.toBe('idp-sub-1');
  });

  it('links a verified email and swaps the subject to the local id', async () => {
    await registerUser(db, 'me@b.co', 'password-123', null, 'local');
    const local = await findUserByEmail(db, 'me@b.co');
    const out = await linkOidcUser(db, {
      sub: 'google-123', email: 'me@b.co', roles: [], email_verified: true, provider: 'google',
    } as any);
    expect(out.sub).toBe(local!.sub);
  });

  it('creates a passwordless account for a new social user', async () => {
    const out = await linkOidcUser(db, {
      sub: 'google-999', email: 'new@b.co', roles: [], email_verified: true, provider: 'google',
    } as any);
    const row = await findUserByEmail(db, 'new@b.co');
    expect(row).not.toBeNull();
    expect(out.sub).toBe(row!.sub);
    // password_hash is not on the AuthUser projection; read it raw.
    const raw = await db.get('SELECT password_hash FROM _nk_auth_users WHERE id = ?', row!.sub);
    expect(raw.password_hash).toBe('');
  });
});
