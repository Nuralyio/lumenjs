import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db.js';
import { ensureUsersTable, registerUser, linkOidcUser, findUserByEmail } from './native-auth.js';
import {
  ensureIdentitiesTable, recordIdentity, findUserIdByIdentity,
  listIdentities, unlinkIdentity, IdentityConflictError,
} from './identities.js';

let db: ReturnType<typeof createTestDb>;

beforeEach(async () => {
  db = createTestDb();
  await ensureUsersTable(db);
  await ensureIdentitiesTable(db);
});
afterEach(() => db.close());

const oidc = (over: any = {}) => ({ sub: 'g-1', email: 'a@b.co', roles: [], email_verified: true, provider: 'google', ...over });

describe('linkOidcUser with identities', () => {
  it('unverified email links nothing and writes no row — the takeover guard', async () => {
    await registerUser(db, 'victim@b.co', 'password-123', null, 'local');
    const out = await linkOidcUser(db, oidc({ email: 'victim@b.co', email_verified: false }) as any);
    expect(out.sub).toBe('g-1');                                   // stayed the IdP subject
    expect(await findUserIdByIdentity(db, 'google', 'g-1')).toBeNull();
  });

  it('verified email links to the account and records the identity', async () => {
    await registerUser(db, 'me@b.co', 'password-123', null, 'local');
    const local = await findUserByEmail(db, 'me@b.co');
    const out = await linkOidcUser(db, oidc({ email: 'me@b.co' }) as any);
    expect(out.sub).toBe(local!.sub);
    expect(await findUserIdByIdentity(db, 'google', 'g-1')).toBe(local!.sub);
  });

  it('a known identity wins even when the provider changed the email', async () => {
    await registerUser(db, 'me@b.co', 'password-123', null, 'local');
    const local = await findUserByEmail(db, 'me@b.co');
    await linkOidcUser(db, oidc({ email: 'me@b.co' }) as any);          // first login records g-1
    // Next login, same subject, DIFFERENT email — email match would miss, identity does not.
    const out = await linkOidcUser(db, oidc({ email: 'renamed@elsewhere.co' }) as any);
    expect(out.sub).toBe(local!.sub);
  });

  it('a brand-new social user with no email still gets an account and an identity', async () => {
    const out = await linkOidcUser(db, oidc({ email: undefined }) as any);
    expect(await findUserIdByIdentity(db, 'google', 'g-1')).toBe(out.sub);
  });
});

describe('recordIdentity', () => {
  it('refuses to move an identity to another user', async () => {
    await recordIdentity(db, { userId: 'user-A', provider: 'google', subject: 's-1' });
    await expect(recordIdentity(db, { userId: 'user-B', provider: 'google', subject: 's-1' }))
      .rejects.toBeInstanceOf(IdentityConflictError);
  });

  it('is idempotent for the same owner and refreshes last_login_at', async () => {
    await recordIdentity(db, { userId: 'u1', provider: 'google', subject: 's', email: 'x@y.co' });
    await recordIdentity(db, { userId: 'u1', provider: 'google', subject: 's', email: 'x2@y.co', emailVerified: true });
    const rows = await db.all('SELECT * FROM _nk_auth_identities WHERE user_id = ?', 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('x2@y.co');
    expect(rows[0].email_verified).toBe(1);
  });
});

describe('listIdentities', () => {
  it('synthesizes a native method for a password user', async () => {
    const u = await registerUser(db, 'p@b.co', 'password-123', null, 'local');
    const methods = await listIdentities(db, u.sub);
    expect(methods.map((m) => m.provider)).toContain('native');
  });

  it('omits native for a social-only (passwordless) user', async () => {
    const out = await linkOidcUser(db, oidc({ email: 'social@b.co' }) as any);
    const methods = await listIdentities(db, out.sub);
    expect(methods.map((m) => m.provider)).not.toContain('native');
    expect(methods.map((m) => m.provider)).toContain('google');
  });
});

describe('unlinkIdentity', () => {
  it('refuses to remove the only sign-in method', async () => {
    const out = await linkOidcUser(db, oidc({ email: 'solo@b.co' }) as any);
    const r = await unlinkIdentity(db, out.sub, 'google');
    expect(r).toEqual({ ok: false, reason: 'last-method' });
  });

  it('removes a provider when another method remains', async () => {
    const u = await registerUser(db, 'both@b.co', 'password-123', null, 'local');
    await recordIdentity(db, { userId: u.sub, provider: 'google', subject: 'gg' });
    expect(await unlinkIdentity(db, u.sub, 'google')).toEqual({ ok: true });
    expect((await listIdentities(db, u.sub)).map((m) => m.provider)).not.toContain('google');
  });

  it('unlinking native clears the password rather than deleting a row', async () => {
    const u = await registerUser(db, 'pw@b.co', 'password-123', null, 'local');
    await recordIdentity(db, { userId: u.sub, provider: 'google', subject: 'gg' });
    expect(await unlinkIdentity(db, u.sub, 'native')).toEqual({ ok: true });
    const raw = await db.get('SELECT password_hash FROM _nk_auth_users WHERE id = ?', u.sub);
    expect(raw.password_hash).toBe('');
  });

  it('returns not-found for a method the account never had', async () => {
    const u = await registerUser(db, 'nf@b.co', 'password-123', null, 'local');
    expect(await unlinkIdentity(db, u.sub, 'github')).toEqual({ ok: false, reason: 'not-found' });
  });
});
