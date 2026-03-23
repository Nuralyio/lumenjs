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
    roles TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
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
 */
export function linkOidcUser(db: Db, oidcUser: AuthUser): AuthUser {
  if (!oidcUser.email) return oidcUser;

  const existing = db.get<any>('SELECT * FROM _nk_auth_users WHERE email = ?', oidcUser.email);
  if (existing) {
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
