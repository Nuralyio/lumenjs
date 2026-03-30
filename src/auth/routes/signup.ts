import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig } from '../types.js';
import { getNativeProvider } from '../config.js';
import {
  encryptSession,
  createSessionCookie,
} from '../session.js';
import { sendJson, readBody, isTokenMode } from './utils.js';

export async function handleNativeSignup(
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

  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return true;
  }
  const { email, password, name } = body;

  if (!email || !password) {
    sendJson(res, 400, { error: 'Email and password required' });
    return true;
  }

  try {
    const { registerUser, ensureUsersTable, generateVerificationToken } = await import('../native-auth.js');
    await ensureUsersTable(db);
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
      createdAt: Math.floor(Date.now() / 1000),
    };

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Token mode: return bearer tokens
    if (isTokenMode(url, req) && config.token.enabled) {
      const { issueAccessToken, generateRefreshToken, storeRefreshToken, ensureRefreshTokenTable } = await import('../token.js');
      await ensureRefreshTokenTable(db);
      const accessToken = issueAccessToken(user, config.session.secret, config.token.accessTokenTTL);
      const refreshToken = generateRefreshToken();
      await storeRefreshToken(db, refreshToken, user.sub, config.token.refreshTokenTTL);
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
