import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, OIDCProvider } from '../types.js';
import { getOidcProvider, hasNativeAuth, getNativeProvider } from '../config.js';
import {
  discoverProvider,
  buildAuthorizationUrl,
  generateCodeVerifier,
} from '../oidc-client.js';
import {
  encryptSession,
  createSessionCookie,
} from '../session.js';
import { sendJson, readBody, isTokenMode, safeReturnTo } from './utils.js';

/**
 * Handle OIDC login — redirect to provider's authorization endpoint.
 * Returns true if handled, false if no OIDC provider found (caller should fall through).
 */
export async function handleOidcLogin(
  config: ResolvedAuthConfig,
  res: ServerResponse,
  url: URL,
  providerName: string | undefined,
): Promise<boolean> {
  const oidc = providerName
    ? config.providers.find(p => p.type === 'oidc' && p.name === providerName) as OIDCProvider | undefined
    : getOidcProvider(config) as OIDCProvider | undefined;

  if (!oidc) {
    // No OIDC provider — return available methods as JSON
    sendJson(res, 200, {
      providers: config.providers.map(p => ({ type: p.type, name: p.name })),
      nativeLogin: `${config.routes.login} (POST)`,
      signup: hasNativeAuth(config) ? config.routes.signup : undefined,
    });
    return true;
  }

  const metadata = await discoverProvider(oidc.issuer);
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), config.routes.postLogin);
  const redirectUri = `${url.origin}${config.routes.callback}`;

  // Store PKCE state in short-lived encrypted cookie
  const stateData = JSON.stringify({ state, codeVerifier, returnTo, provider: oidc.name });
  const encrypted = await encryptSession(
    { accessToken: stateData, expiresAt: Math.floor(Date.now() / 1000) + 600, user: { sub: '', roles: [] } },
    config.session.secret,
  );
  const stateCookie = createSessionCookie('nk-auth-state', encrypted, 600, config.session.secure);

  const authUrl = buildAuthorizationUrl(
    metadata,
    oidc.clientId,
    redirectUri,
    oidc.scopes || ['openid', 'profile', 'email'],
    state,
    codeVerifier,
  );

  res.writeHead(302, { Location: authUrl, 'Set-Cookie': stateCookie });
  res.end();
  return true;
}

export async function handleNativeLogin(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  db?: any,
): Promise<boolean> {
  const nativeProvider = getNativeProvider(config);
  if (!nativeProvider || !db) {
    sendJson(res, 400, { error: 'Native auth not configured' });
    return true;
  }

  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return true;
  }
  const { email, password } = body;

  if (!email || !password) {
    sendJson(res, 400, { error: 'Email and password required' });
    return true;
  }

  const { authenticateUser, isEmailVerified } = await import('../native-auth.js');
  const user = await authenticateUser(db, email, password);
  if (!user) {
    sendJson(res, 401, { error: 'Invalid credentials' });
    return true;
  }

  // Check email verification if required
  if (nativeProvider.requireEmailVerification && !isEmailVerified(db, user.sub)) {
    sendJson(res, 403, { error: 'Please verify your email before signing in', code: 'EMAIL_NOT_VERIFIED' });
    return true;
  }

  // Create session — same as OIDC callback
  const sessionData = {
    accessToken: `native:${user.sub}`,
    expiresAt: Math.floor(Date.now() / 1000) + config.session.maxAge,
    user,
    provider: 'native',
    createdAt: Math.floor(Date.now() / 1000),
  };

  const encrypted = await encryptSession(sessionData, config.session.secret);
  const cookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);

  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), config.routes.postLogin);

  // Token mode: return bearer tokens instead of cookie
  if (isTokenMode(url, req) && config.token.enabled) {
    const { issueAccessToken, generateRefreshToken, storeRefreshToken, ensureRefreshTokenTable } = await import('../token.js');
    ensureRefreshTokenTable(db);
    const accessToken = issueAccessToken(user, config.session.secret, config.token.accessTokenTTL);
    const refreshToken = generateRefreshToken();
    storeRefreshToken(db, refreshToken, user.sub, config.token.refreshTokenTTL);
    sendJson(res, 200, { accessToken, refreshToken, expiresIn: config.token.accessTokenTTL, tokenType: 'Bearer', user });
    return true;
  }

  // Cookie mode: set session cookie
  if (req.headers.accept?.includes('application/json')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookie });
    res.end(JSON.stringify({ user, returnTo }));
  } else {
    res.writeHead(302, { Location: returnTo, 'Set-Cookie': cookie });
    res.end();
  }
  return true;
}
