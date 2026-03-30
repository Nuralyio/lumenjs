import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig } from '../types.js';
import { sendJson, readBody } from './utils.js';

export async function handleTokenRefresh(
  config: ResolvedAuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!config.token.enabled || !db) {
    sendJson(res, 400, { error: 'Token auth not configured' });
    return true;
  }

  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return true;
  }
  const { refreshToken } = body;
  if (!refreshToken) {
    sendJson(res, 400, { error: 'refreshToken required' });
    return true;
  }

  const { validateRefreshToken, deleteRefreshToken, storeRefreshToken, generateRefreshToken, issueAccessToken, ensureRefreshTokenTable } = await import('../token.js');
  await ensureRefreshTokenTable(db);

  const userId = await validateRefreshToken(db, refreshToken);
  if (!userId) {
    sendJson(res, 401, { error: 'Invalid or expired refresh token' });
    return true;
  }

  // Rotate: delete old, issue new
  await deleteRefreshToken(db, refreshToken);

  // Look up user from DB
  const { findUserByEmail } = await import('../native-auth.js');
  const row = await db.get('SELECT * FROM _nk_auth_users WHERE id = ?', userId);
  if (!row) {
    sendJson(res, 401, { error: 'User not found' });
    return true;
  }

  let roles: string[] = [];
  try { roles = JSON.parse(row.roles); } catch {}
  const user = { sub: row.id, email: row.email, name: row.name, roles, provider: 'native' as const };

  const newAccessToken = issueAccessToken(user, config.session.secret, config.token.accessTokenTTL);
  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(db, newRefreshToken, userId, config.token.refreshTokenTTL);

  sendJson(res, 200, { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: config.token.accessTokenTTL });
  return true;
}

export async function handleTokenRevoke(
  req: IncomingMessage,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  if (!db) {
    sendJson(res, 400, { error: 'Token auth not configured' });
    return true;
  }

  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return true;
  }
  const { refreshToken } = body;
  if (!refreshToken) {
    sendJson(res, 400, { error: 'refreshToken required' });
    return true;
  }

  const { deleteRefreshToken } = await import('../token.js');
  await deleteRefreshToken(db, refreshToken);

  sendJson(res, 200, { ok: true });
  return true;
}
