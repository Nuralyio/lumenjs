import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, OIDCProvider } from './types.js';
import { getOidcProvider, getNativeProvider, hasNativeAuth } from './config.js';
import {
  discoverProvider,
  buildAuthorizationUrl,
  generateCodeVerifier,
  exchangeCode,
  extractUser,
} from './oidc-client.js';
import {
  encryptSession,
  createSessionCookie,
  clearSessionCookie,
  parseSessionCookie,
  decryptSession,
} from './session.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Check if request wants token-based auth (mobile) — only with explicit ?mode=token */
function isTokenMode(url: URL, _req: IncomingMessage): boolean {
  return url.searchParams.get('mode') === 'token';
}

/**
 * Handle auth routes (login, callback, logout, signup, me).
 * Supports both OIDC and native auth.
 * Returns true if the request was handled.
 */
export async function handleAuthRoutes(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const routes = config.routes;

  // ── Login (GET) — redirect to OIDC or show available methods ──
  // /__nk_auth/login/<provider> — specific provider
  // /__nk_auth/login — default provider or first OIDC
  if (pathname.startsWith(routes.login)) {
    const providerName = pathname.slice(routes.login.length + 1) || undefined; // e.g. "keycloak"

    // Native login via POST
    if (req.method === 'POST') {
      return handleNativeLogin(config, req, res, url, db);
    }

    // OIDC login
    const oidc = providerName
      ? config.providers.find(p => p.type === 'oidc' && p.name === providerName) as OIDCProvider | undefined
      : getOidcProvider(config) as OIDCProvider | undefined;

    if (!oidc) {
      // No OIDC provider — return available methods as JSON
      sendJson(res, 200, {
        providers: config.providers.map(p => ({ type: p.type, name: p.name })),
        nativeLogin: `${routes.login} (POST)`,
        signup: hasNativeAuth(config) ? routes.signup : undefined,
      });
      return true;
    }

    const metadata = await discoverProvider(oidc.issuer);
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const returnTo = url.searchParams.get('returnTo') || routes.postLogin;
    const redirectUri = `${url.origin}${routes.callback}`;

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

  // ── Signup (POST) — native registration ───────────────────────
  if (pathname === routes.signup && req.method === 'POST') {
    return handleNativeSignup(config, req, res, db);
  }

  // ── Callback — OIDC code exchange ─────────────────────────────
  if (pathname === routes.callback) {
    return handleOidcCallback(config, req, res, url, db);
  }

  // ── Logout ────────────────────────────────────────────────────
  if (pathname === routes.logout) {
    return handleLogout(config, req, res, url);
  }

  // ── Me — return current user ──────────────────────────────────
  if (pathname === '/__nk_auth/me') {
    const user = (req as any).nkAuth?.user ?? null;
    sendJson(res, 200, user);
    return true;
  }

  // ── Verify email ───────────────────────────────────────────────
  if (pathname === '/__nk_auth/verify-email' && req.method === 'GET') {
    return handleVerifyEmail(config, url, res, db);
  }

  // ── Forgot password (request reset) ───────────────────────────
  if (pathname === '/__nk_auth/forgot-password' && req.method === 'POST') {
    return handleForgotPassword(config, req, res, db);
  }

  // ── Reset password (with token) ───────────────────────────────
  if (pathname === '/__nk_auth/reset-password' && req.method === 'POST') {
    return handleResetPassword(config, req, res, db);
  }

  // ── Refresh — exchange refresh token for new access token ─────
  if (pathname === '/__nk_auth/refresh' && req.method === 'POST') {
    return handleTokenRefresh(config, req, res, db);
  }

  // ── Revoke — invalidate refresh token (mobile logout) ─────────
  if (pathname === '/__nk_auth/revoke' && req.method === 'POST') {
    return handleTokenRevoke(req, res, db);
  }

  return false;
}

// ── Native Login ────────────────────────────────────────────────

async function handleNativeLogin(
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

  const body = JSON.parse(await readBody(req));
  const { email, password } = body;

  if (!email || !password) {
    sendJson(res, 400, { error: 'Email and password required' });
    return true;
  }

  const { authenticateUser, isEmailVerified } = await import('./native-auth.js');
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
  };

  const encrypted = await encryptSession(sessionData, config.session.secret);
  const cookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);

  const returnTo = url.searchParams.get('returnTo') || config.routes.postLogin;

  // Token mode: return bearer tokens instead of cookie
  if (isTokenMode(url, req) && config.token.enabled) {
    const { issueAccessToken, generateRefreshToken, storeRefreshToken, ensureRefreshTokenTable } = await import('./token.js');
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

// ── Native Signup ───────────────────────────────────────────────

async function handleNativeSignup(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const nativeProvider = getNativeProvider(config);
  if (!nativeProvider || !db) {
    sendJson(res, 400, { error: 'Native auth not configured' });
    return true;
  }

  if (nativeProvider.allowRegistration === false) {
    sendJson(res, 403, { error: 'Registration is disabled' });
    return true;
  }

  const body = JSON.parse(await readBody(req));
  const { email, password, name } = body;

  if (!email || !password) {
    sendJson(res, 400, { error: 'Email and password required' });
    return true;
  }

  try {
    const { registerUser, ensureUsersTable, generateVerificationToken } = await import('./native-auth.js');
    ensureUsersTable(db);
    const user = await registerUser(db, email, password, name, nativeProvider);

    // Send verification email if required
    if (nativeProvider.requireEmailVerification && config.onEvent) {
      const token = generateVerificationToken(user.sub, config.session.secret);
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const verifyUrl = `${origin}/__nk_auth/verify-email?token=${encodeURIComponent(token)}`;
      try { await config.onEvent({ type: 'verification-email', email, token, url: verifyUrl }); } catch {}
    }

    // If email verification required, don't auto-login
    if (nativeProvider.requireEmailVerification) {
      sendJson(res, 201, { user, message: 'Account created. Please check your email to verify.' });
      return true;
    }

    // Auto-login after signup
    const sessionData = {
      accessToken: `native:${user.sub}`,
      expiresAt: Math.floor(Date.now() / 1000) + config.session.maxAge,
      user,
      provider: 'native',
    };

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Token mode: return bearer tokens
    if (isTokenMode(url, req) && config.token.enabled) {
      const { issueAccessToken, generateRefreshToken, storeRefreshToken, ensureRefreshTokenTable } = await import('./token.js');
      ensureRefreshTokenTable(db);
      const accessToken = issueAccessToken(user, config.session.secret, config.token.accessTokenTTL);
      const refreshToken = generateRefreshToken();
      storeRefreshToken(db, refreshToken, user.sub, config.token.refreshTokenTTL);
      sendJson(res, 201, { accessToken, refreshToken, expiresIn: config.token.accessTokenTTL, tokenType: 'Bearer', user });
      return true;
    }

    // Cookie mode
    const encrypted = await encryptSession(sessionData, config.session.secret);
    const cookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);

    if (req.headers.accept?.includes('application/json')) {
      res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': cookie });
      res.end(JSON.stringify({ user }));
    } else {
      res.writeHead(302, { Location: config.routes.postLogin, 'Set-Cookie': cookie });
      res.end();
    }
  } catch (err: any) {
    sendJson(res, 400, { error: err.message });
  }
  return true;
}

// ── OIDC Callback ───────────────────────────────────────────────

async function handleOidcCallback(
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

  let user = extractUser(tokens.id_token || tokens.access_token);
  user.provider = oidc.name;

  // Account linking: if native auth is also configured, link by email
  if (db && hasNativeAuth(config) && user.email) {
    try {
      const { linkOidcUser, ensureUsersTable } = await import('./native-auth.js');
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
  };

  const encrypted = await encryptSession(sessionData, config.session.secret);
  const sessionCookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);
  const clearState = clearSessionCookie('nk-auth-state');

  res.writeHead(302, { Location: returnTo || '/', 'Set-Cookie': [sessionCookie, clearState] });
  res.end();
  return true;
}

// ── Logout ──────────────────────────────────────────────────────

async function handleLogout(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const clearCookie = clearSessionCookie(config.session.cookieName);

  // Check if this was an OIDC session — redirect to provider's end_session_endpoint
  let idToken: string | undefined;
  let providerName: string | undefined;
  const cookieHeader = req.headers.cookie || '';
  const sessionCookie = parseSessionCookie(cookieHeader, config.session.cookieName);
  if (sessionCookie) {
    const session = await decryptSession(sessionCookie, config.session.secret);
    idToken = session?.idToken || undefined;
    providerName = session?.provider;
  }

  let redirectUrl = config.routes.postLogout;

  // If OIDC session, try provider logout
  if (providerName && idToken) {
    const oidc = config.providers.find(p => p.type === 'oidc' && p.name === providerName) as OIDCProvider | undefined;
    if (oidc) {
      try {
        const metadata = await discoverProvider(oidc.issuer);
        if (metadata.end_session_endpoint) {
          const params = new URLSearchParams({
            id_token_hint: idToken,
            post_logout_redirect_uri: `${url.origin}${config.routes.postLogout}`,
          });
          redirectUrl = `${metadata.end_session_endpoint}?${params}`;
        }
      } catch {}
    }
  }

  res.writeHead(302, { Location: redirectUrl, 'Set-Cookie': clearCookie });
  res.end();
  return true;
}

// ── Verify Email ────────────────────────────────────────────────

async function handleVerifyEmail(
  config: ResolvedAuthConfig,
  url: URL,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const token = url.searchParams.get('token');

  // If no DB or no token, redirect to verify page which shows proper UI
  if (!db || !token) {
    res.writeHead(302, { Location: `/auth/verify${token ? '?token=' + encodeURIComponent(token) : '?error=missing'}` });
    res.end();
    return true;
  }

  const { verifyVerificationToken, verifyUserEmail } = await import('./native-auth.js');
  const userId = verifyVerificationToken(token, config.session.secret);
  if (!userId) {
    res.writeHead(302, { Location: '/auth/verify?error=invalid' });
    res.end();
    return true;
  }

  const verified = verifyUserEmail(db, userId);
  if (!verified) {
    res.writeHead(302, { Location: '/auth/verify?error=not_found' });
    res.end();
    return true;
  }

  // Redirect to login page with success message
  res.writeHead(302, { Location: `${config.routes.loginPage}?verified=true` });
  res.end();
  return true;
}

// ── Forgot Password ─────────────────────────────────────────────

async function handleForgotPassword(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!db) {
    sendJson(res, 400, { error: 'Native auth not configured' });
    return true;
  }

  const body = JSON.parse(await readBody(req));
  const { email } = body;
  if (!email) {
    sendJson(res, 400, { error: 'Email required' });
    return true;
  }

  const { findUserIdByEmail, generateResetToken } = await import('./native-auth.js');
  const userId = findUserIdByEmail(db, email);

  // Always return success (don't reveal if email exists)
  if (userId && config.onEvent) {
    const token = generateResetToken(userId, config.session.secret);
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    const resetUrl = `${origin}/__nk_auth/reset-password?token=${encodeURIComponent(token)}`;
    try { await config.onEvent({ type: 'password-reset', email, token, url: resetUrl }); } catch {}
  }

  sendJson(res, 200, { message: 'If an account with that email exists, a password reset link has been sent.' });
  return true;
}

// ── Reset Password ──────────────────────────────────────────────

async function handleResetPassword(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!db) {
    sendJson(res, 400, { error: 'Native auth not configured' });
    return true;
  }

  const body = JSON.parse(await readBody(req));
  const { token, password } = body;

  if (!token || !password) {
    sendJson(res, 400, { error: 'Token and password required' });
    return true;
  }

  const { verifyResetToken, updatePassword } = await import('./native-auth.js');
  const userId = verifyResetToken(token, config.session.secret);
  if (!userId) {
    sendJson(res, 400, { error: 'Invalid or expired reset link' });
    return true;
  }

  const nativeProvider = getNativeProvider(config);
  const minLength = nativeProvider?.minPasswordLength ?? 8;

  try {
    await updatePassword(db, userId, password, minLength);
  } catch (err: any) {
    sendJson(res, 400, { error: err.message });
    return true;
  }

  // Notify via event hook
  const row = db.get('SELECT email FROM _nk_auth_users WHERE id = ?', userId);
  if (row && config.onEvent) {
    try { await config.onEvent({ type: 'password-changed', email: row.email, userId }); } catch {}
  }

  sendJson(res, 200, { message: 'Password has been reset. You can now sign in.' });
  return true;
}

// ── Token Refresh ───────────────────────────────────────────────

async function handleTokenRefresh(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!config.token.enabled || !db) {
    sendJson(res, 400, { error: 'Token auth not configured' });
    return true;
  }

  const body = JSON.parse(await readBody(req));
  const { refreshToken } = body;
  if (!refreshToken) {
    sendJson(res, 400, { error: 'refreshToken required' });
    return true;
  }

  const { validateRefreshToken, deleteRefreshToken, storeRefreshToken, generateRefreshToken, issueAccessToken, ensureRefreshTokenTable } = await import('./token.js');
  ensureRefreshTokenTable(db);

  const userId = validateRefreshToken(db, refreshToken);
  if (!userId) {
    sendJson(res, 401, { error: 'Invalid or expired refresh token' });
    return true;
  }

  // Rotate: delete old, issue new
  deleteRefreshToken(db, refreshToken);

  // Look up user from DB
  const { findUserByEmail } = await import('./native-auth.js');
  const row = db.get('SELECT * FROM _nk_auth_users WHERE id = ?', userId);
  if (!row) {
    sendJson(res, 401, { error: 'User not found' });
    return true;
  }

  let roles: string[] = [];
  try { roles = JSON.parse(row.roles); } catch {}
  const user = { sub: row.id, email: row.email, name: row.name, roles, provider: 'native' as const };

  const newAccessToken = issueAccessToken(user, config.session.secret, config.token.accessTokenTTL);
  const newRefreshToken = generateRefreshToken();
  storeRefreshToken(db, newRefreshToken, userId, config.token.refreshTokenTTL);

  sendJson(res, 200, { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: config.token.accessTokenTTL });
  return true;
}

// ── Token Revoke ────────────────────────────────────────────────

async function handleTokenRevoke(
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!db) {
    sendJson(res, 400, { error: 'Token auth not configured' });
    return true;
  }

  const body = JSON.parse(await readBody(req));
  const { refreshToken } = body;
  if (!refreshToken) {
    sendJson(res, 400, { error: 'refreshToken required' });
    return true;
  }

  const { deleteRefreshToken } = await import('./token.js');
  deleteRefreshToken(db, refreshToken);

  sendJson(res, 200, { ok: true });
  return true;
}
