/**
 * Which sign-in methods an account has — the records that make a profile
 * possible and account-linking safe.
 *
 * Before this, linkOidcUser matched by email and wrote nothing: no table knew
 * that an account had ever used Google, nothing could unlink it, and a user
 * whose provider changed their email silently became a second account. This is
 * that missing record.
 *
 * The invariant that makes it safe lives in the schema: PRIMARY KEY
 * (provider, subject). One Google account can never be attached to two local
 * users. Everything else is bookkeeping around that constraint.
 *
 * `linked_at` carries no SQL DEFAULT on purpose — the value is passed from JS
 * as an ISO string, so this table's DDL is byte-identical on SQLite and
 * Postgres and needs no dialect translation at all.
 */
import type { AuthDb } from './db.js';
import { randomUUID } from 'crypto';

export interface AuthIdentity {
  userId: string;
  provider: string;
  subject: string;
  email?: string;
  emailVerified: boolean;
  linkedAt: string;
  lastLoginAt?: string;
}

/** Raised when a (provider, subject) already belongs to a different user.
 *  `ownerUserId` is for server-side logging only — it must never be echoed to
 *  the caller, or one user learns another's id. */
export class IdentityConflictError extends Error {
  constructor(public readonly ownerUserId: string) {
    super('identity already linked to another account');
    this.name = 'IdentityConflictError';
  }
}

export async function ensureIdentitiesTable(db: AuthDb): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS _nk_auth_identities (
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    linked_at TEXT NOT NULL,
    last_login_at TEXT,
    PRIMARY KEY (provider, subject)
  )`);
  try { await db.exec('CREATE INDEX IF NOT EXISTS idx_nk_auth_identities_user ON _nk_auth_identities(user_id)'); } catch {}
}

/** The stable resolution: (provider, subject) → local user id. Survives an
 *  email change at the provider, which the email-only path cannot. */
export async function findUserIdByIdentity(db: AuthDb, provider: string, subject: string): Promise<string | null> {
  const row = await db.get<{ user_id: string }>(
    'SELECT user_id FROM _nk_auth_identities WHERE provider = ? AND subject = ?', provider, subject);
  return row?.user_id ?? null;
}

/**
 * Idempotent upsert of an identity, refreshing email/verified/last_login on a
 * repeat sign-in. Throws IdentityConflictError if the (provider, subject)
 * already belongs to a different user.
 *
 * INSERT OR IGNORE then a scoped UPDATE: the PG translator turns the former
 * into ON CONFLICT DO NOTHING, so this is race-safe in both dialects without
 * needing dialect-specific upsert syntax. If the UPDATE changed nothing, the
 * row exists under another owner — read it back and refuse.
 */
export async function recordIdentity(db: AuthDb, params: {
  userId: string; provider: string; subject: string; email?: string; emailVerified?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT OR IGNORE INTO _nk_auth_identities (user_id, provider, subject, email, email_verified, linked_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params.userId, params.provider, params.subject,
    params.email ?? null, params.emailVerified ? 1 : 0, now, now,
  );
  const upd = await db.run(
    `UPDATE _nk_auth_identities SET email = ?, email_verified = ?, last_login_at = ?
     WHERE provider = ? AND subject = ? AND user_id = ?`,
    params.email ?? null, params.emailVerified ? 1 : 0, now,
    params.provider, params.subject, params.userId,
  );
  if (upd.changes === 0) {
    const owner = await findUserIdByIdentity(db, params.provider, params.subject);
    if (owner && owner !== params.userId) throw new IdentityConflictError(owner);
  }
}

/**
 * Every sign-in method on an account.
 *
 * The native (password) method is SYNTHESIZED from the user row's
 * password_hash rather than stored — which is what lets accounts predating
 * this table appear correct with no backfill: a password user shows a native
 * method, a social-only user (empty hash) does not.
 */
export async function listIdentities(db: AuthDb, userId: string): Promise<AuthIdentity[]> {
  const rows = await db.all<any>(
    'SELECT * FROM _nk_auth_identities WHERE user_id = ? ORDER BY linked_at', userId);
  const out: AuthIdentity[] = rows.map((r) => ({
    userId: r.user_id, provider: r.provider, subject: r.subject,
    email: r.email ?? undefined, emailVerified: !!r.email_verified,
    linkedAt: r.linked_at, lastLoginAt: r.last_login_at ?? undefined,
  }));

  const user = await db.get<{ password_hash: string; email: string; created_at: string }>(
    'SELECT password_hash, email, created_at FROM _nk_auth_users WHERE id = ?', userId);
  if (user && user.password_hash) {
    out.unshift({
      userId, provider: 'native', subject: userId,
      email: user.email, emailVerified: true, linkedAt: user.created_at,
    });
  }
  return out;
}

/**
 * Remove a linked provider — but never the last way in. An account with no
 * password and one identity would become unreachable, so that refusal is the
 * feature. `native` clears the password_hash rather than deleting a row.
 */
export async function unlinkIdentity(db: AuthDb, userId: string, provider: string): Promise<
  { ok: true } | { ok: false; reason: 'not-found' | 'last-method' }
> {
  const methods = await listIdentities(db, userId);
  const target = methods.find((m) => m.provider === provider);
  if (!target) return { ok: false, reason: 'not-found' };
  if (methods.length <= 1) return { ok: false, reason: 'last-method' };

  if (provider === 'native') {
    await db.run("UPDATE _nk_auth_users SET password_hash = '' WHERE id = ?", userId);
  } else {
    await db.run('DELETE FROM _nk_auth_identities WHERE user_id = ? AND provider = ?', userId, provider);
  }
  return { ok: true };
}
