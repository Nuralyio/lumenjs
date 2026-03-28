import crypto from 'node:crypto';
import type { AuthUser, NativeProvider } from './types.js';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384;

/**
 * Hash a password using scrypt (Node.js built-in, no dependencies).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_COST }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_COST }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(derivedKey, Buffer.from(keyHex, 'hex')));
    });
  });
}

/** DB interface — subset of LumenDb */
interface Db {
  all<T = any>(sql: string, ...params: any[]): T[];
  get<T = any>(sql: string, ...params: any[]): T | undefined;
  run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  exec(sql: string): void;
}

/**
 * Ensure the native auth users table exists.
 */
export function ensureUsersTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _nk_auth_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    roles TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Add email_verified column if table already exists without it
  try { db.exec('ALTER TABLE _nk_auth_users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0'); } catch {};
  // Add sessions_revoked_at column for logout-all support
  try { db.exec('ALTER TABLE _nk_auth_users ADD COLUMN sessions_revoked_at TEXT'); } catch {};
}

/**
 * Register a new user with email/password.
 */
export async function registerUser(
  db: Db,
  email: string,
  password: string,
  name?: string,
  provider?: NativeProvider,
): Promise<AuthUser> {
  const minLength = provider?.minPasswordLength ?? 8;
  if (password.length < minLength) {
    throw new Error(`Password must be at least ${minLength} characters`);
  }

  const existing = db.get<any>('SELECT id FROM _nk_auth_users WHERE email = ?', email);
  if (existing) {
    throw new Error('Email already registered');
  }

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);

  db.run(
    'INSERT INTO _nk_auth_users (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
    id, email, name || null, hash,
  );

  return {
    sub: id,
    email,
    name,
    roles: [],
    provider: 'native',
  };
}

/**
 * Authenticate a user with email/password.
 */
export async function authenticateUser(
  db: Db,
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const row = db.get<any>('SELECT * FROM _nk_auth_users WHERE email = ?', email);
  if (!row) return null;

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return null;

  let roles: string[] = [];
  try { roles = JSON.parse(row.roles); } catch {}

  return {
    sub: row.id,
    email: row.email,
    name: row.name,
    roles,
    provider: 'native',
  };
}

/**
 * Find a user by email (for account linking with OIDC).
 */
export function findUserByEmail(db: Db, email: string): AuthUser | null {
  const row = db.get<any>('SELECT * FROM _nk_auth_users WHERE email = ?', email);
  if (!row) return null;

  let roles: string[] = [];
  try { roles = JSON.parse(row.roles); } catch {}

  return {
    sub: row.id,
    email: row.email,
    name: row.name,
    roles,
    provider: 'native',
  };
}

/**
 * Create or link a native user from OIDC claims (account linking by email).
 * Only links to existing native accounts if the OIDC provider has verified the email.
 */
export function linkOidcUser(db: Db, oidcUser: AuthUser): AuthUser {
  if (!oidcUser.email) return oidcUser;

  const existing = db.get<any>('SELECT * FROM _nk_auth_users WHERE email = ?', oidcUser.email);
  if (existing) {
    // Only link if the OIDC provider has verified the email — prevents account takeover
    if (!(oidcUser as any).email_verified) {
      return oidcUser;
    }

    // Merge roles from both sources
    let nativeRoles: string[] = [];
    try { nativeRoles = JSON.parse(existing.roles); } catch {}
    const mergedRoles = [...new Set([...nativeRoles, ...(oidcUser.roles || [])])];

    return {
      ...oidcUser,
      sub: existing.id,
      roles: mergedRoles,
    };
  }

  // Auto-create native user record from OIDC
  const id = crypto.randomUUID();
  const roles = JSON.stringify(oidcUser.roles || []);
  db.run(
    `INSERT INTO _nk_auth_users (id, email, name, password_hash, roles) VALUES (?, ?, ?, '', ?)`,
    id, oidcUser.email, oidcUser.name || null, roles,
  );

  return { ...oidcUser, sub: id };
}

// ── Email Verification ──────────────────────────────────────────

/**
 * Generate an HMAC-signed email verification token.
 * Format: userId.expiry.signature (base64url)
 */
export function generateVerificationToken(userId: string, secret: string, ttlSeconds: number = 86400): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${expiry}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/**
 * Verify and decode an email verification token.
 * Returns userId or null if invalid/expired.
 */
export function verifyVerificationToken(token: string, secret: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0], 'base64url').toString('utf8');
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedSig))) return null;
    const [userId, expiryStr] = payload.split('.');
    if (parseInt(expiryStr) < Math.floor(Date.now() / 1000)) return null;
    return userId;
  } catch { return null; }
}

/** Mark a user's email as verified. */
export function verifyUserEmail(db: Db, userId: string): boolean {
  const result = db.run('UPDATE _nk_auth_users SET email_verified = 1, updated_at = datetime("now") WHERE id = ?', userId);
  return result.changes > 0;
}

/** Check if a user's email is verified. */
export function isEmailVerified(db: Db, userId: string): boolean {
  const row = db.get<any>('SELECT email_verified FROM _nk_auth_users WHERE id = ?', userId);
  return row?.email_verified === 1;
}

// ── Password Reset ──────────────────────────────────────────────

/**
 * Generate an HMAC-signed password reset token.
 * Same format as verification token but shorter TTL (1 hour).
 */
export function generateResetToken(userId: string, secret: string, ttlSeconds: number = 3600): string {
  return generateVerificationToken(userId, secret, ttlSeconds);
}

/** Verify a password reset token. Returns userId or null. */
export function verifyResetToken(token: string, secret: string): string | null {
  return verifyVerificationToken(token, secret);
}

/** Update a user's password. */
export async function updatePassword(db: Db, userId: string, newPassword: string, minLength: number = 8): Promise<void> {
  if (newPassword.length < minLength) throw new Error(`Password must be at least ${minLength} characters`);
  const hash = await hashPassword(newPassword);
  db.run('UPDATE _nk_auth_users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?', hash, userId);
}

/** Find a user by email. Returns { id, email, name } or null. */
export function findUserIdByEmail(db: Db, email: string): string | null {
  const row = db.get<any>('SELECT id FROM _nk_auth_users WHERE email = ?', email);
  return row?.id || null;
}

// ── Session Revocation (Logout All) ─────────────────────────────

/** Set sessions_revoked_at to now, invalidating all sessions created before this moment. */
export function revokeAllSessions(db: Db, userId: string): void {
  db.run('UPDATE _nk_auth_users SET sessions_revoked_at = datetime("now") WHERE id = ?', userId);
}

/** Get the epoch-seconds timestamp of the last logout-all, or null if never revoked. */
export function getSessionsRevokedAt(db: Db, userId: string): number | null {
  const row = db.get<any>('SELECT sessions_revoked_at FROM _nk_auth_users WHERE id = ?', userId);
  if (!row?.sessions_revoked_at) return null;
  return Math.floor(new Date(row.sessions_revoked_at + 'Z').getTime() / 1000);
}
