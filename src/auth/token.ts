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

/** The cookie the edge reads. Named once, so nothing sets a name nothing reads. */
export const ACCESS_TOKEN_COOKIE = 'nk-access-token';

/**
 * Set the access token as a cookie beside the encrypted session cookie.
 *
 * A browser login only ever got `nk-session`, which holds an AES-GCM blob only
 * this process can open. The OpenResty gateway in front of the agents console
 * verifies an HMAC JWT and reads exactly this cookie, so without it every
 * request from a logged-in browser was a 401 at the edge. Same credential,
 * second transport — the mobile WebView path in middleware.ts already reads it.
 *
 * Lifetime is the session's, not `token.accessTokenTTL`: nothing re-issues this
 * cookie on a request that never reaches this process (the console talks to the
 * gateway and the engine only), so a 15-minute token would log the console out
 * 15 minutes after login. The cost is that `logout-all` cannot revoke it at the
 * edge — the gateway is stateless by design — so it is cleared on logout here
 * and expires with the session at the latest.
 */
export function createAccessTokenCookie(
  user: AuthUser,
  secret: string,
  maxAge: number,
  secure: boolean,
): string {
  const token = issueAccessToken(user, secret, maxAge);
  let cookie = `${ACCESS_TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  if (secure) cookie += '; Secure';
  return cookie;
}

/** Expire the access-token cookie. Sent with every cookie-clearing response. */
export function clearAccessTokenCookie(): string {
  return `${ACCESS_TOKEN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
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

import { nowDefault, autoIncrementPk, type AuthDb as Db } from './db.js';

export async function ensureRefreshTokenTable(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS _nk_auth_refresh_tokens (
    id ${autoIncrementPk(db)},
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${nowDefault(db)}
  )`);
}

export async function storeRefreshToken(db: Db, token: string, userId: string, ttlSeconds: number): Promise<void> {
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await db.run(
    'INSERT INTO _nk_auth_refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    tokenHash, userId, expiresAt,
  );
}

export async function validateRefreshToken(db: Db, token: string): Promise<string | null> {
  const tokenHash = hashRefreshToken(token);
  const row = await db.get<any>(
    'SELECT user_id, expires_at FROM _nk_auth_refresh_tokens WHERE token_hash = ?',
    tokenHash,
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.run('DELETE FROM _nk_auth_refresh_tokens WHERE token_hash = ?', tokenHash);
    return null;
  }
  return row.user_id;
}

export async function deleteRefreshToken(db: Db, token: string): Promise<void> {
  const tokenHash = hashRefreshToken(token);
  await db.run('DELETE FROM _nk_auth_refresh_tokens WHERE token_hash = ?', tokenHash);
}

export async function deleteAllRefreshTokens(db: Db, userId: string): Promise<void> {
  await db.run('DELETE FROM _nk_auth_refresh_tokens WHERE user_id = ?', userId);
}
