import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, NkAuth, OIDCProvider } from './types.js';
import { parseSessionCookie, decryptSession, encryptSession, createSessionCookie, shouldRefreshSession } from './session.js';

type NextFn = (err?: any) => void;

/** Type augmentation — makes `req.nkAuth` available without casting */
declare module 'http' {
  interface IncomingMessage {
    nkAuth?: NkAuth | null;
  }
}

export type ConnectMiddleware = (req: IncomingMessage, res: ServerResponse, next: NextFn) => Promise<void>;

/**
 * Create Connect middleware that parses the session cookie and attaches req.nkAuth.
 * Works with both OIDC and native auth sessions — the cookie format is identical.
 *
 * Behavior:
 * 1. Skip non-page requests (/@, /node_modules, static files with `.`)
 * 2. Check Bearer token (mobile/API clients)
 * 3. Parse + decrypt session cookie → attach req.nkAuth
 * 4. Refresh OIDC tokens if expiring within 5 minutes
 * 5. Always call next() — never blocks the middleware chain
 */
export function createAuthMiddleware(config: ResolvedAuthConfig, db?: any): ConnectMiddleware {
  return async (req: IncomingMessage, res: ServerResponse, next: NextFn): Promise<void> => {
    const url = req.url || '';

    // Skip non-page requests
    if (url.startsWith('/@') || url.startsWith('/node_modules') || url.includes('.')) {
      return next();
    }

    req.nkAuth = null;

    // 1. Check bearer token first (mobile apps)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { verifyAccessToken } = await import('./token.js');
        const user = verifyAccessToken(authHeader.slice(7), config.session.secret);
        if (user) {
          req.nkAuth = { user, session: { accessToken: authHeader.slice(7), expiresAt: 0, user } };
          return next();
        }
      } catch { /* Invalid token — fall through to cookie auth */ }
    }

    // 2. Fall back to cookie-based session (browsers)
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return next();

    const sessionCookie = parseSessionCookie(cookieHeader, config.session.cookieName);
    if (!sessionCookie) return next();

    const session = await decryptSession(sessionCookie, config.session.secret);
    if (!session) return next();

    req.nkAuth = { user: session.user, session };

    // 3. Check if session was revoked via logout-all
    if (db && session.createdAt && session.user?.sub) {
      try {
        const { getSessionsRevokedAt } = await import('./native-auth.js');
        const revokedAt = await getSessionsRevokedAt(db, session.user.sub);
        if (revokedAt && session.createdAt <= revokedAt) {
          req.nkAuth = null;
          return next();
        }
      } catch { /* Revocation check failed — deny access (fail closed) */
        req.nkAuth = null;
        return next();
      }
    }

    // 4. Refresh OIDC tokens if about to expire (native sessions don't expire the same way)
    if (shouldRefreshSession(session) && session.refreshToken && session.provider !== 'native') {
      const oidc = config.providers.find(
        p => p.type === 'oidc' && p.name === session.provider,
      ) as OIDCProvider | undefined;

      if (oidc) {
        try {
          const { discoverProvider, refreshTokens, extractUser } = await import('./oidc-client.js');
          const metadata = await discoverProvider(oidc.issuer);
          const tokens = await refreshTokens(metadata, oidc.clientId, oidc.clientSecret, session.refreshToken!);
          const user = extractUser(tokens.id_token || session.idToken || '', undefined);
          user.provider = oidc.name;

          const newSession = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || session.refreshToken,
            idToken: tokens.id_token || session.idToken,
            expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
            user,
            provider: oidc.name,
            createdAt: session.createdAt ?? Math.floor(Date.now() / 1000),
          };

          const encrypted = await encryptSession(newSession, config.session.secret);
          const cookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);
          res.setHeader('Set-Cookie', cookie);
          req.nkAuth = { user: newSession.user, session: newSession };
        } catch { /* OIDC token refresh failed — keep existing session */ }
      }
    }

    next();
  };
}
