import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, AuthUser } from '../types.js';
import { getRedirectProvider, getRedirectProviderByName, hasNativeAuth } from '../config.js';
import {
  discoverProvider,
  exchangeCode,
  extractUser,
  validateIdTokenClaims,
  decodeJwtPayload,
} from '../oidc-client.js';
import {
  encryptSession,
  createSessionCookie,
  clearSessionCookie,
  parseSessionCookie,
  decryptSession,
} from '../session.js';
import { sendJson, safeReturnTo } from './utils.js';

export async function handleOidcCallback(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  db?: any,
): Promise<boolean> {
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (!code || !stateParam) {
    sendJson(res, 400, { error: 'Missing code or state' });
    return true;
  }

  const cookieHeader = req.headers.cookie || '';
  const stateCookie = parseSessionCookie(cookieHeader, 'nk-auth-state');
  if (!stateCookie) {
    sendJson(res, 400, { error: 'Missing state cookie' });
    return true;
  }

  const stateSession = await decryptSession(stateCookie, config.session.secret);
  if (!stateSession) {
    sendJson(res, 400, { error: 'Invalid state cookie' });
    return true;
  }

  const { state, codeVerifier, returnTo, provider: providerName } = JSON.parse(stateSession.accessToken);
  if (state !== stateParam) {
    sendJson(res, 400, { error: 'State mismatch' });
    return true;
  }

  // The provider that started this flow — oidc or oauth2, by the name in state.
  const provider = providerName
    ? getRedirectProviderByName(config, providerName)
    : getRedirectProvider(config);

  if (!provider) {
    sendJson(res, 400, { error: 'Unknown provider' });
    return true;
  }

  const redirectUri = `${url.origin}${config.routes.callback}`;

  let user: AuthUser;
  let accessToken: string;
  let refreshToken: string | undefined;
  let idToken: string | undefined;
  let expiresAt: number;

  if (provider.type === 'oauth2') {
    const { exchangeOAuth2Code, resolveOAuth2User } = await import('../oauth2-client.js');
    const tokens = await exchangeOAuth2Code(provider, code, redirectUri, codeVerifier);
    user = await resolveOAuth2User(provider, tokens);
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    // A GitHub OAuth app omits expires_in; fall back to the session lifetime.
    expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in ?? config.session.maxAge);
  } else {
    const metadata = await discoverProvider(provider.issuer);
    const tokens = await exchangeCode(metadata, provider.clientId, provider.clientSecret, code, redirectUri, codeVerifier);
    if (tokens.id_token) {
      validateIdTokenClaims(decodeJwtPayload(tokens.id_token), provider.issuer, provider.clientId);
    }
    user = extractUser(tokens.id_token || tokens.access_token);
    user.provider = provider.name;
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    idToken = tokens.id_token;
    expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
  }

  // Account linking: if native auth is also configured, link by verified email.
  // No longer gated on user.email — a GitHub user whose email is private still
  // resolves through their recorded identity (feature 1).
  if (db && hasNativeAuth(config)) {
    try {
      const { linkOidcUser, ensureUsersTable } = await import('../native-auth.js');
      await ensureUsersTable(db);
      user = await linkOidcUser(db, user);
    } catch (linkErr) {
      console.warn('[LumenJS Auth] account linking failed:', (linkErr as any)?.message ?? linkErr);
    }
  }

  const { issueLoginSession } = await import('./session-issue.js');
  await issueLoginSession(config, res, {
    user, accessToken, refreshToken, idToken, expiresAt, provider: provider.name, returnTo,
  });
  return true;
}
