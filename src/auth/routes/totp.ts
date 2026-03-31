import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig } from '../types.js';
import { sendJson, readBody } from './utils.js';
import { encryptSession, createSessionCookie, decryptSession } from '../session.js';
import {
  encryptTotpSecret, decryptTotpSecret,
  saveTotpSecret, enableTotp, disableTotp, getTotpState,
} from '../native-auth.js';

function parseCookies(req: IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  }
  return cookies;
}

/**
 * POST /__nk_auth/totp/setup
 * Generates a new TOTP secret for the authenticated user and returns a QR code.
 */
export async function handleTotpSetup(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const user = (req as any).nkAuth?.user;
  if (!user?.sub) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
  if (!db) { sendJson(res, 500, { error: 'Database unavailable' }); return true; }

  try {
    const { authenticator } = await import('otplib');
    const QRCode = await import('qrcode');

    const secret = authenticator.generateSecret();
    const appName = (config as any).totp?.appName || 'Nuraly';
    const otpauthUri = authenticator.keyuri(user.email || user.sub, appName, secret);
    const qrDataUrl = await QRCode.default.toDataURL(otpauthUri);

    const encrypted = await encryptTotpSecret(secret, config.session.secret);
    await saveTotpSecret(db, user.sub, encrypted);

    sendJson(res, 200, { qrDataUrl, otpauthUri });
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'Setup failed' });
  }
  return true;
}

/**
 * POST /__nk_auth/totp/verify-setup
 * Confirms setup by verifying the first 6-digit code and enables TOTP.
 */
export async function handleTotpVerifySetup(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const user = (req as any).nkAuth?.user;
  if (!user?.sub) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
  if (!db) { sendJson(res, 500, { error: 'Database unavailable' }); return true; }

  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return true; }

  const { code } = body;
  if (!code) { sendJson(res, 400, { error: 'Code required' }); return true; }

  try {
    const { authenticator } = await import('otplib');
    const state = await getTotpState(db, user.sub);
    if (!state.encryptedSecret) { sendJson(res, 400, { error: 'No pending TOTP setup' }); return true; }

    const secret = await decryptTotpSecret(state.encryptedSecret, config.session.secret);
    const valid = authenticator.check(code, secret);
    if (!valid) { sendJson(res, 400, { error: 'Invalid code — check your authenticator app and try again' }); return true; }

    await enableTotp(db, user.sub);
    sendJson(res, 200, { ok: true });
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'Verification failed' });
  }
  return true;
}

/**
 * POST /__nk_auth/totp/disable
 * Disables TOTP after verifying a valid code.
 */
export async function handleTotpDisable(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const user = (req as any).nkAuth?.user;
  if (!user?.sub) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
  if (!db) { sendJson(res, 500, { error: 'Database unavailable' }); return true; }

  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return true; }

  const { code } = body;
  if (!code) { sendJson(res, 400, { error: 'Code required' }); return true; }

  try {
    const { authenticator } = await import('otplib');
    const state = await getTotpState(db, user.sub);
    if (!state.totpEnabled || !state.encryptedSecret) { sendJson(res, 400, { error: '2FA is not enabled' }); return true; }

    const secret = await decryptTotpSecret(state.encryptedSecret, config.session.secret);
    const valid = authenticator.check(code, secret);
    if (!valid) { sendJson(res, 400, { error: 'Invalid code' }); return true; }

    await disableTotp(db, user.sub);
    sendJson(res, 200, { ok: true });
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'Failed to disable 2FA' });
  }
  return true;
}

/**
 * POST /__nk_auth/totp/challenge
 * Exchanges a pending-2FA cookie + valid TOTP code for a full session cookie.
 */
export async function handleTotpChallenge(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!db) { sendJson(res, 500, { error: 'Database unavailable' }); return true; }

  const cookies = parseCookies(req);
  const pendingEncrypted = cookies['nk-totp-pending'];
  if (!pendingEncrypted) { sendJson(res, 401, { error: 'No pending 2FA session' }); return true; }

  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return true; }

  const { code } = body;
  if (!code) { sendJson(res, 400, { error: 'Code required' }); return true; }

  try {
    // Decrypt and validate the pending session
    const pending = await decryptSession(pendingEncrypted, config.session.secret);
    if (!pending || !pending.accessToken.startsWith('totp-pending:')) { sendJson(res, 401, { error: 'Invalid pending session' }); return true; }
    if (pending.expiresAt < Math.floor(Date.now() / 1000)) { sendJson(res, 401, { error: '2FA session expired — please log in again' }); return true; }

    const userId = pending.accessToken.slice('totp-pending:'.length);

    // Fetch full user row
    const row = await db.get('SELECT * FROM _nk_auth_users WHERE id = ?', userId) as any;
    if (!row) { sendJson(res, 401, { error: 'User not found' }); return true; }

    // Verify TOTP code
    const { authenticator } = await import('otplib');
    if (!row.totp_enabled || !row.totp_secret) { sendJson(res, 400, { error: '2FA not enabled for this account' }); return true; }

    const secret = await decryptTotpSecret(row.totp_secret, config.session.secret);
    const valid = authenticator.check(code, secret);
    if (!valid) { sendJson(res, 400, { error: 'Invalid code — check your authenticator app and try again' }); return true; }

    // Build full user object
    let roles: string[] = [];
    try { roles = JSON.parse(row.roles); } catch {}
    const user = { sub: row.id, email: row.email, name: row.name, roles, provider: 'native' as const };

    // Issue full session cookie
    const sessionData = {
      accessToken: `native:${user.sub}`,
      expiresAt: Math.floor(Date.now() / 1000) + config.session.maxAge,
      user,
      provider: 'native',
      createdAt: Math.floor(Date.now() / 1000),
    };
    const encrypted = await encryptSession(sessionData, config.session.secret);
    const sessionCookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);

    // Clear the pending cookie
    const clearPending = `nk-totp-pending=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${config.session.secure ? '; Secure' : ''}`;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const returnTo = url.searchParams.get('returnTo') || config.routes.postLogin;

    if (req.headers.accept?.includes('application/json')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': [sessionCookie, clearPending] });
      res.end(JSON.stringify({ user, returnTo }));
    } else {
      res.writeHead(302, { Location: returnTo, 'Set-Cookie': [sessionCookie, clearPending] });
      res.end();
    }
  } catch (err: any) {
    sendJson(res, 500, { error: err.message || 'Challenge failed' });
  }
  return true;
}
