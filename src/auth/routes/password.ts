import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig } from '../types.js';
import { getNativeProvider } from '../config.js';
import { sendJson, readBody } from './utils.js';

export async function handleForgotPassword(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!db) {
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
  const { email } = body;
  if (!email) {
    sendJson(res, 400, { error: 'Email required' });
    return true;
  }

  const { findUserIdByEmail, generateResetToken } = await import('../native-auth.js');
  const userId = findUserIdByEmail(db, email);

  // Always return success (don't reveal if email exists)
  if (userId && config.onEvent) {
    const userRow = db.get('SELECT password_hash FROM _nk_auth_users WHERE id = ?', userId);
    const token = generateResetToken(userId, config.session.secret, 3600, userRow?.password_hash);
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    const resetUrl = `${origin}/__nk_auth/reset-password?token=${encodeURIComponent(token)}`;
    try { await config.onEvent({ type: 'password-reset', email, token, url: resetUrl }); } catch {}
  }

  sendJson(res, 200, { message: 'If an account with that email exists, a password reset link has been sent.' });
  return true;
}

export async function handleResetPassword(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!db) {
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
  const { token, password } = body;

  if (!token || !password) {
    sendJson(res, 400, { error: 'Token and password required' });
    return true;
  }

  const { verifyResetToken, updatePassword, decodeResetTokenUserId } = await import('../native-auth.js');
  // First, decode the userId from the token payload (without full verification)
  // so we can look up the current password hash for single-use validation
  const candidateUserId = decodeResetTokenUserId(token);
  let currentHash: string | undefined;
  if (candidateUserId) {
    const userRow = db.get('SELECT password_hash FROM _nk_auth_users WHERE id = ?', candidateUserId);
    currentHash = userRow?.password_hash;
  }
  const userId = verifyResetToken(token, config.session.secret, currentHash);
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

export async function handleChangePassword(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const user = (req as any).nkAuth?.user;
  if (!user) {
    sendJson(res, 401, { error: 'Authentication required' });
    return true;
  }

  if (!db) {
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
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    sendJson(res, 400, { error: 'Current password and new password required' });
    return true;
  }

  const { verifyPassword, updatePassword } = await import('../native-auth.js');

  const row = db.get('SELECT password_hash FROM _nk_auth_users WHERE id = ?', user.sub);
  if (!row) {
    sendJson(res, 404, { error: 'User not found' });
    return true;
  }

  const valid = await verifyPassword(currentPassword, row.password_hash);
  if (!valid) {
    sendJson(res, 401, { error: 'Current password is incorrect' });
    return true;
  }

  const nativeProvider = getNativeProvider(config);
  const minLength = nativeProvider?.minPasswordLength ?? 8;

  try {
    await updatePassword(db, user.sub, newPassword, minLength);
  } catch (err: any) {
    sendJson(res, 400, { error: err.message });
    return true;
  }

  if (config.onEvent) {
    try { await config.onEvent({ type: 'password-changed', email: user.email, userId: user.sub }); } catch {}
  }

  sendJson(res, 200, { message: 'Password updated successfully' });
  return true;
}
