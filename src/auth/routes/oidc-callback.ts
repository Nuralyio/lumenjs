import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, OIDCProvider } from '../types.js';
import { getOidcProvider, hasNativeAuth } from '../config.js';
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

  // Find the OIDC provider that initiated this flow
  const oidc = (providerName
    ? config.providers.find(p => p.type === 'oidc' && p.name === providerName)
    : getOidcProvider(config)) as OIDCProvider | undefined;

  if (!oidc) {
    sendJson(res, 400, { error: 'Unknown OIDC provider' });
    return true;
  }

  const metadata = await discoverProvider(oidc.issuer);
  const redirectUri = `${url.origin}${config.routes.callback}`;
  const tokens = await exchangeCode(metadata, oidc.clientId, oidc.clientSecret, code, redirectUri, codeVerifier);

  // Validate ID token claims (iss, aud, exp) before trusting
  if (tokens.id_token) {
    const claims = decodeJwtPayload(tokens.id_token);
    validateIdTokenClaims(claims, oidc.issuer, oidc.clientId);
  }

  let user = extractUser(tokens.id_token || tokens.access_token);
  user.provider = oidc.name;

  // Account linking: if native auth is also configured, link by email
  if (db && hasNativeAuth(config) && user.email) {
    try {
      const { linkOidcUser, ensureUsersTable } = await import('../native-auth.js');
      ensureUsersTable(db);
      user = linkOidcUser(db, user);
    } catch {}
  }

  const sessionData = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
    user,
    provider: oidc.name,
    createdAt: Math.floor(Date.now() / 1000),
  };

  const encrypted = await encryptSession(sessionData, config.session.secret);
  const sessionCookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);
  const clearState = clearSessionCookie('nk-auth-state');

  res.writeHead(302, { Location: safeReturnTo(returnTo, '/'), 'Set-Cookie': [sessionCookie, clearState] });
  res.end();
  return true;
}
