import crypto from 'node:crypto';
import type { OIDCMetadata, TokenSet, AuthUser } from './types.js';

const metadataCache = new Map<string, OIDCMetadata>();

export async function discoverProvider(issuer: string): Promise<OIDCMetadata> {
  const cached = metadataCache.get(issuer);
  if (cached) return cached;

  const url = issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
  const metadata = await res.json() as OIDCMetadata;
  metadataCache.set(issuer, metadata);
  return metadata;
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizationUrl(
  metadata: OIDCMetadata,
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
  codeVerifier: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: generateCodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });
  return `${metadata.authorization_endpoint}?${params}`;
}

export async function exchangeCode(
  metadata: OIDCMetadata,
  clientId: string,
  clientSecret: string | undefined,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const res = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }
  return res.json() as Promise<TokenSet>;
}

export async function refreshTokens(
  metadata: OIDCMetadata,
  clientId: string,
  clientSecret: string | undefined,
  refreshToken: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const res = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  return res.json() as Promise<TokenSet>;
}

export async function fetchUserInfo(metadata: OIDCMetadata, accessToken: string): Promise<Record<string, any>> {
  const res = await fetch(metadata.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`UserInfo fetch failed: ${res.status}`);
  return res.json();
}

export function decodeJwtPayload(token: string): Record<string, any> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(payload);
}

/**
 * Validate basic ID token claims (iss, aud, exp) after decoding.
 * Note: Full JWKS signature verification is not yet implemented.
 * The token is received directly from the provider's token endpoint over TLS,
 * which provides transport-level trust, but does not satisfy OIDC §3.1.3.7.
 */
export function validateIdTokenClaims(
  claims: Record<string, any>,
  issuer: string,
  clientId: string,
): void {
  if (claims.iss && claims.iss !== issuer) {
    throw new Error(`ID token issuer mismatch: expected ${issuer}, got ${claims.iss}`);
  }
  if (claims.aud) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(clientId)) {
      throw new Error(`ID token audience mismatch: expected ${clientId}`);
    }
  }
  if (claims.exp && typeof claims.exp === 'number') {
    if (claims.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('ID token has expired');
    }
  }
}

export function extractUser(idToken: string, userInfo?: Record<string, any>): AuthUser {
  const claims = decodeJwtPayload(idToken);
  const merged = { ...claims, ...userInfo };
  return {
    sub: merged.sub,
    email: merged.email,
    name: merged.name || merged.preferred_username,
    preferred_username: merged.preferred_username,
    roles: merged.realm_access?.roles || merged.roles || [],
    ...merged,
  };
}
