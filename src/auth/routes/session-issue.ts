import type { ServerResponse } from 'http';
import type { ResolvedAuthConfig, AuthUser } from '../types.js';
import { encryptSession, createSessionCookie, clearSessionCookie } from '../session.js';
import { safeReturnTo } from './utils.js';

/**
 * Seal a successful redirect login and 302 the browser home. The single path
 * both the OIDC and OAuth2 callbacks issue their session through, so the cookie
 * semantics (encrypted session, edge access token, clearing the PKCE state)
 * cannot drift between two copies.
 */
export async function issueLoginSession(
  config: ResolvedAuthConfig,
  res: ServerResponse,
  opts: {
    user: AuthUser;
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: number;
    provider: string;
    returnTo: string;
  },
): Promise<void> {
  const sessionData = {
    accessToken: opts.accessToken ?? '',
    refreshToken: opts.refreshToken,
    idToken: opts.idToken,
    expiresAt: opts.expiresAt,
    user: opts.user,
    provider: opts.provider,
    createdAt: Math.floor(Date.now() / 1000),
  };

  const encrypted = await encryptSession(sessionData, config.session.secret);
  const sessionCookie = createSessionCookie(
    config.session.cookieName, encrypted, config.session.maxAge, config.session.secure,
  );
  const clearState = clearSessionCookie('nk-auth-state');
  const { createAccessTokenCookie } = await import('../token.js');
  const edgeCookie = createAccessTokenCookie(
    opts.user, config.session.secret, config.session.maxAge, config.session.secure,
  );

  res.writeHead(302, {
    Location: safeReturnTo(opts.returnTo, '/'),
    'Set-Cookie': [sessionCookie, edgeCookie, clearState],
  });
  res.end();
}
