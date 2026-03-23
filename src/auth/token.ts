import crypto from 'node:crypto';
import type { AuthUser } from './types.js';

/**
 * Issue a short-lived access token (HMAC-SHA256 signed, stateless).
 * Format: base64url(payload).base64url(signature)
 */
export function issueAccessToken(user: AuthUser, secret: string, ttlSeconds: number): string {
  const payload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    roles: user.roles || [],
    provider: user.provider,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

/**
 * Verify and decode an access token. Returns the user or null if invalid/expired.
 */
export function verifyAccessToken(token: string, secret: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;

    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      roles: payload.roles || [],
      provider: payload.provider,
    };
  } catch {
    return null;
  }
}

/**
 * Generate an opaque refresh token (random bytes, stored hashed in DB).
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash a refresh token for DB storage (SHA-256).
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── DB helpers for refresh tokens ────────────────────────────────

interface Db {
  all<T = any>(sql: string, ...params: any[]): T[];
  get<T = any>(sql: string, ...params: any[]): T | undefined;
  run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  exec(sql: string): void;
}

export function ensureRefreshTokenTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _nk_auth_refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export function storeRefreshToken(db: Db, token: string, userId: string, ttlSeconds: number): void {
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  db.run(
    'INSERT INTO _nk_auth_refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    tokenHash, userId, expiresAt,
  );
}

export function validateRefreshToken(db: Db, token: string): string | null {
  const tokenHash = hashRefreshToken(token);
  const row = db.get<any>(
    'SELECT user_id, expires_at FROM _nk_auth_refresh_tokens WHERE token_hash = ?',
    tokenHash,
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.run('DELETE FROM _nk_auth_refresh_tokens WHERE token_hash = ?', tokenHash);
    return null;
  }
  return row.user_id;
}

export function deleteRefreshToken(db: Db, token: string): void {
  const tokenHash = hashRefreshToken(token);
  db.run('DELETE FROM _nk_auth_refresh_tokens WHERE token_hash = ?', tokenHash);
}

export function deleteAllRefreshTokens(db: Db, userId: string): void {
  db.run('DELETE FROM _nk_auth_refresh_tokens WHERE user_id = ?', userId);
}
