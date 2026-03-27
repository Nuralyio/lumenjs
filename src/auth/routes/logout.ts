import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, OIDCProvider } from '../types.js';
import { discoverProvider } from '../oidc-client.js';
import {
  clearSessionCookie,
  parseSessionCookie,
  decryptSession,
} from '../session.js';
import { sendJson } from './utils.js';

export async function handleLogout(
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

export async function handleLogoutAll(
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

  // Set sessions_revoked_at — any session created before this timestamp is invalid
  const { revokeAllSessions, ensureUsersTable } = await import('../native-auth.js');
  ensureUsersTable(db);
  revokeAllSessions(db, user.sub);

  // Delete all refresh tokens (mobile/API sessions)
  try {
    const { deleteAllRefreshTokens, ensureRefreshTokenTable } = await import('../token.js');
    ensureRefreshTokenTable(db);
    deleteAllRefreshTokens(db, user.sub);
  } catch {}

  // Clear current session cookie
  const clearCookie = clearSessionCookie(config.session.cookieName);

  if (req.headers.accept?.includes('application/json')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie });
    res.end(JSON.stringify({ ok: true, message: 'All sessions have been signed out' }));
  } else {
    res.writeHead(302, { Location: config.routes.postLogout, 'Set-Cookie': clearCookie });
    res.end();
  }
  return true;
}
