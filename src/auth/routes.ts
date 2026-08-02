import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig } from './types.js';
import { sendJson } from './routes/utils.js';
import { handleNativeLogin, handleOidcLogin } from './routes/login.js';
import { handleNativeSignup } from './routes/signup.js';
import { handleOidcCallback } from './routes/oidc-callback.js';
import { handleListIdentities, handleStartLink, handleUnlinkIdentity } from './routes/identities.js';
import { handleLogout, handleLogoutAll } from './routes/logout.js';
import { handleVerifyEmail } from './routes/verify.js';
import { handleForgotPassword, handleResetPassword, handleChangePassword } from './routes/password.js';
import { handleTokenRefresh, handleTokenRevoke } from './routes/token.js';
import { handleTotpSetup, handleTotpVerifySetup, handleTotpDisable, handleTotpChallenge } from './routes/totp.js';

/** Validate the Origin header on POST requests to block CSRF; true if safe to proceed. */
function checkOrigin(req: IncomingMessage, url: URL): boolean {
  if (req.method !== 'POST') return true;
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // Allow requests without Origin (non-browser clients)
  try {
    const originUrl = new URL(origin);
    if (originUrl.origin === url.origin) return true;
    // Behind reverse proxy: check X-Forwarded-Host
    const fwdHost = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim();
    if (fwdHost && originUrl.host === fwdHost) return true;
    // Match hostname only (ignore port differences from proxy)
    if (originUrl.hostname === url.hostname) return true;
    return false;
  } catch {
    return false;
  }
}

/** Handle auth routes (OIDC and native); returns true if the request was handled. */
export async function handleAuthRoutes(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const routes = config.routes;

  if (req.method === 'POST' && !checkOrigin(req, url)) {
    sendJson(res, 403, { error: 'Origin mismatch — possible CSRF' });
    return true;
  }

  if (pathname.startsWith(routes.login)) {
    const providerName = pathname.slice(routes.login.length + 1) || undefined; // e.g. "keycloak"
    if (req.method === 'POST') {
      return handleNativeLogin(config, req, res, url, db);
    }
    return handleOidcLogin(config, res, url, providerName);
  }

  if (pathname === routes.signup && req.method === 'POST') {
    return handleNativeSignup(config, req, res, db);
  }

  if (pathname === routes.callback) {
    return handleOidcCallback(config, req, res, url, db);
  }

  if (pathname === routes.logout) {
    return handleLogout(config, req, res, url, db);
  }

  if (pathname === '/__nk_auth/logout-all' && req.method === 'POST') {
    return handleLogoutAll(config, req, res, db);
  }

  if (pathname === '/__nk_auth/identities' && req.method === 'GET') {
    return handleListIdentities(config, req, res, db);
  }
  if (pathname === '/__nk_auth/identities/unlink' && req.method === 'POST') {
    return handleUnlinkIdentity(config, req, res, db);
  }
  if (pathname.startsWith('/__nk_auth/link/') && req.method === 'GET') {
    return handleStartLink(config, req, res, url, pathname.slice('/__nk_auth/link/'.length));
  }

  if (pathname === '/__nk_auth/me') {
    const user = (req as any).nkAuth?.user ?? null;
    sendJson(res, 200, user);
    return true;
  }

  if (pathname === '/__nk_auth/verify-email' && req.method === 'GET') {
    return handleVerifyEmail(config, url, res, db);
  }

  if (pathname === '/__nk_auth/forgot-password' && req.method === 'POST') {
    return handleForgotPassword(config, req, res, db);
  }

  if (pathname === '/__nk_auth/reset-password' && req.method === 'POST') {
    return handleResetPassword(config, req, res, db);
  }

  if (pathname === '/__nk_auth/change-password' && req.method === 'POST') {
    return handleChangePassword(config, req, res, db);
  }

  if (pathname === '/__nk_auth/refresh' && req.method === 'POST') {
    return handleTokenRefresh(config, req, res, db);
  }

  if (pathname === '/__nk_auth/revoke' && req.method === 'POST') {
    return handleTokenRevoke(req, res, db);
  }

  if (pathname === '/__nk_auth/totp/setup' && req.method === 'POST') {
    return handleTotpSetup(config, req, res, db);
  }
  if (pathname === '/__nk_auth/totp/verify-setup' && req.method === 'POST') {
    return handleTotpVerifySetup(config, req, res, db);
  }
  if (pathname === '/__nk_auth/totp/disable' && req.method === 'POST') {
    return handleTotpDisable(config, req, res, db);
  }
  if (pathname === '/__nk_auth/totp/challenge' && req.method === 'POST') {
    return handleTotpChallenge(config, req, res, db);
  }

  return false;
}
