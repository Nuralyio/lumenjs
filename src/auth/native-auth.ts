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
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  run(sql: string, ...params: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  exec(sql: string): Promise<void>;
}

/**
 * Ensure the native auth users table exists.
 */
export async function ensureUsersTable(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS _nk_auth_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    roles TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT NOW(),
    updated_at TEXT NOT NULL DEFAULT NOW()
  )`);
  // Add email_verified column if table already exists without it
  try { await db.exec('ALTER TABLE _nk_auth_users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0'); } catch {};
  // Add sessions_revoked_at column for logout-all support
  try { await db.exec('ALTER TABLE _nk_auth_users ADD COLUMN sessions_revoked_at TEXT'); } catch {};
  // Add TOTP columns
  try { await db.exec('ALTER TABLE _nk_auth_users ADD COLUMN totp_secret TEXT'); } catch {};
  try { await db.exec('ALTER TABLE _nk_auth_users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0'); } catch {};
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
  // Basic email format validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email address');
  }

  const MAX_PASSWORD_LENGTH = 128;
  const minLength = provider?.minPasswordLength ?? 8;
  if (password.length < minLength) {
    throw new Error(`Password must be at least ${minLength} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }

  const existing = await db.get<any>('SELECT id FROM _nk_auth_users WHERE email = ?', email);
  if (existing) {
    throw new Error('Email already registered');
  }

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);

  await db.run(
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
  const row = await db.get<any>('SELECT * FROM _nk_auth_users WHERE email = ?', email);
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
export async function findUserByEmail(db: Db, email: string): Promise<AuthUser | null> {
  const row = await db.get<any>('SELECT * FROM _nk_auth_users WHERE email = ?', email);
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
export async function linkOidcUser(db: Db, oidcUser: AuthUser): Promise<AuthUser> {
  if (!oidcUser.email) return oidcUser;

  const existing = await db.get<any>('SELECT * FROM _nk_auth_users WHERE email = ?', oidcUser.email);
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
  await db.run(
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
export async function verifyUserEmail(db: Db, userId: string): Promise<boolean> {
  const result = await db.run('UPDATE _nk_auth_users SET email_verified = 1, updated_at = datetime("now") WHERE id = ?', userId);
  return result.changes > 0;
}

/** Check if a user's email is verified. */
export async function isEmailVerified(db: Db, userId: string): Promise<boolean> {
  const row = await db.get<any>('SELECT email_verified FROM _nk_auth_users WHERE id = ?', userId);
  return row?.email_verified === 1;
}

// ── Password Reset ──────────────────────────────────────────────

/**
 * Generate an HMAC-signed password reset token.
 * Includes a hash of the current password hash so the token auto-invalidates
 * after the password is changed (single-use without server state).
 */
export function generateResetToken(userId: string, secret: string, ttlSeconds: number = 3600, currentPasswordHash?: string): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  // Include a fingerprint of the current password hash to invalidate on change
  const pwFingerprint = currentPasswordHash
    ? crypto.createHash('sha256').update(currentPasswordHash).digest('hex').slice(0, 8)
    : '';
  const payload = `${userId}.${expiry}.${pwFingerprint}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/** Verify a password reset token. Returns userId or null. */
export function verifyResetToken(token: string, secret: string, currentPasswordHash?: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0], 'base64url').toString('utf8');
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedSig))) return null;
    const segments = payload.split('.');
    const [userId, expiryStr] = segments;
    const pwFingerprint = segments[2] || '';
    if (parseInt(expiryStr) < Math.floor(Date.now() / 1000)) return null;
    // Verify password hasn't changed since token was issued
    if (pwFingerprint && currentPasswordHash) {
      const currentFingerprint = crypto.createHash('sha256').update(currentPasswordHash).digest('hex').slice(0, 8);
      if (pwFingerprint !== currentFingerprint) return null;
    }
    return userId;
  } catch { return null; }
}

/** Decode the userId from a reset token payload without verifying. */
export function decodeResetTokenUserId(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0], 'base64url').toString('utf8');
    return payload.split('.')[0] || null;
  } catch { return null; }
}

/** Update a user's password. */
export async function updatePassword(db: Db, userId: string, newPassword: string, minLength: number = 8): Promise<void> {
  if (newPassword.length < minLength) throw new Error(`Password must be at least ${minLength} characters`);
  if (newPassword.length > 128) throw new Error('Password must be at most 128 characters');
  const hash = await hashPassword(newPassword);
  await db.run('UPDATE _nk_auth_users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?', hash, userId);
}

/** Find a user by email. Returns { id, email, name } or null. */
export async function findUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const row = await db.get<any>('SELECT id FROM _nk_auth_users WHERE email = ?', email);
  return row?.id || null;
}

// ── TOTP helpers ─────────────────────────────────────────────────

const TOTP_IV_LEN = 12;
const TOTP_ALGO = 'aes-256-gcm' as const;

function deriveTotpKey(sessionSecret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', sessionSecret, 'totp-key', '', 32));
}

export async function encryptTotpSecret(secret: string, sessionSecret: string): Promise<string> {
  const key = deriveTotpKey(sessionSecret);
  const iv = crypto.randomBytes(TOTP_IV_LEN);
  const cipher = crypto.createCipheriv(TOTP_ALGO, key, iv) as crypto.CipherGCM;
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export async function decryptTotpSecret(encrypted: string, sessionSecret: string): Promise<string> {
  const [ivB64, encB64, tagB64] = encrypted.split('.');
  if (!ivB64 || !encB64 || !tagB64) throw new Error('Invalid TOTP secret format');
  const key = deriveTotpKey(sessionSecret);
  const decipher = crypto.createDecipheriv(TOTP_ALGO, key, Buffer.from(ivB64, 'base64url')) as crypto.DecipherGCM;
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return decipher.update(Buffer.from(encB64, 'base64url')).toString('utf8') + decipher.final('utf8');
}

export async function saveTotpSecret(db: Db, userId: string, encryptedSecret: string): Promise<void> {
  await db.run('UPDATE _nk_auth_users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', encryptedSecret, userId);
}

export async function enableTotp(db: Db, userId: string): Promise<void> {
  await db.run('UPDATE _nk_auth_users SET totp_enabled = 1 WHERE id = ?', userId);
}

export async function disableTotp(db: Db, userId: string): Promise<void> {
  await db.run('UPDATE _nk_auth_users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', userId);
}

export async function getTotpState(db: Db, userId: string): Promise<{ totpEnabled: boolean; encryptedSecret: string | null }> {
  const row = await db.get<any>('SELECT totp_enabled, totp_secret FROM _nk_auth_users WHERE id = ?', userId);
  return { totpEnabled: !!row?.totp_enabled, encryptedSecret: row?.totp_secret || null };
}

// ── Session Revocation (Logout All) ─────────────────────────────

/** Set sessions_revoked_at to now, invalidating all sessions created before this moment. */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.run('UPDATE _nk_auth_users SET sessions_revoked_at = datetime("now") WHERE id = ?', userId);
}

/** Get the epoch-seconds timestamp of the last logout-all, or null if never revoked. */
export async function getSessionsRevokedAt(db: Db, userId: string): Promise<number | null> {
  const row = await db.get<any>('SELECT sessions_revoked_at FROM _nk_auth_users WHERE id = ?', userId);
  if (!row?.sessions_revoked_at) return null;
  return Math.floor(new Date(row.sessions_revoked_at + 'Z').getTime() / 1000);
}
