import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, NkAuth, OIDCProvider } from './types.js';
import { parseSessionCookie, decryptSession, encryptSession, createSessionCookie, shouldRefreshSession } from './session.js';

type NextFn = (err?: any) => void;

/**
 * Create Connect middleware that parses the session cookie and attaches req.nkAuth.
 * Works with both OIDC and native auth sessions — the cookie format is identical.
 */
export function createAuthMiddleware(config: ResolvedAuthConfig) {
  return async (req: IncomingMessage, res: ServerResponse, next: NextFn): Promise<void> => {
    const url = (req as any).url || '';

    // Skip non-page requests
    if (url.startsWith('/@') || url.startsWith('/node_modules') || url.includes('.')) {
      return next();
    }

    (req as any).nkAuth = null;

    // 1. Check bearer token first (mobile apps)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { verifyAccessToken } = await import('./token.js');
        const user = verifyAccessToken(authHeader.slice(7), config.session.secret);
        if (user) {
          (req as any).nkAuth = { user, session: { accessToken: authHeader.slice(7), expiresAt: 0, user } } as NkAuth;
          return next();
        }
      } catch {}
    }

    // 2. Fall back to cookie-based session (browsers)
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return next();

    const sessionCookie = parseSessionCookie(cookieHeader, config.session.cookieName);
    if (!sessionCookie) return next();

    const session = await decryptSession(sessionCookie, config.session.secret);
    if (!session) return next();

    (req as any).nkAuth = { user: session.user, session } as NkAuth;

    // Refresh OIDC tokens if about to expire (native sessions don't expire the same way)
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
          };

          const encrypted = await encryptSession(newSession, config.session.secret);
          const cookie = createSessionCookie(config.session.cookieName, encrypted, config.session.maxAge, config.session.secure);
          res.setHeader('Set-Cookie', cookie);
          (req as any).nkAuth = { user: newSession.user, session: newSession };
        } catch {
          // Refresh failed — keep existing session
        }
      }
    }

    next();
  };
}
