import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig, SessionData, AuthUser, NkAuth } from './types.js';

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('./session.js', () => ({
  parseSessionCookie: vi.fn(),
  decryptSession: vi.fn(),
  encryptSession: vi.fn(),
  createSessionCookie: vi.fn(),
  shouldRefreshSession: vi.fn(),
}));

vi.mock('./token.js', () => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock('./oidc-client.js', () => ({
  discoverProvider: vi.fn(),
  refreshTokens: vi.fn(),
  extractUser: vi.fn(),
}));

import { parseSessionCookie, decryptSession, encryptSession, createSessionCookie, shouldRefreshSession } from './session.js';
import { verifyAccessToken } from './token.js';
import { discoverProvider, refreshTokens, extractUser } from './oidc-client.js';
import { createAuthMiddleware } from './middleware.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeReq(overrides: Record<string, any> = {}): IncomingMessage {
  return { url: '/', headers: {}, ...overrides } as any;
}

function makeRes(): ServerResponse & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader(name: string, value: string) { headers[name] = value; },
  } as any;
}

const baseConfig: ResolvedAuthConfig = {
  providers: [
    { type: 'oidc', name: 'keycloak', issuer: 'https://idp.test', clientId: 'app', clientSecret: 's3cret' },
  ],
  session: { secret: 'test-secret-32-chars-long-enough!', cookieName: 'nk_session', maxAge: 86400, secure: false },
  routes: { login: '/login', loginPage: '/login', callback: '/cb', logout: '/logout', signup: '/signup', postLogin: '/', postLogout: '/' },
  guards: { defaultAuth: false },
  token: { enabled: false, accessTokenTTL: 900, refreshTokenTTL: 604800 },
};

const fakeUser: AuthUser = { sub: 'u1', email: 'a@b.com', name: 'Alice', roles: ['user'], provider: 'keycloak' };

const fakeSession: SessionData = {
  accessToken: 'at', refreshToken: 'rt', idToken: 'idt',
  expiresAt: Math.floor(Date.now() / 1000) + 3600, user: fakeUser, provider: 'keycloak',
};

// ── Tests ────────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  let middleware: (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = createAuthMiddleware(baseConfig);
  });

  // ── Request skipping ─────────────────────────────────────────

  describe('request skipping', () => {
    it('skips requests starting with /@', async () => {
      const req = makeReq({ url: '/@vite/client' });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
      expect((req as any).nkAuth).toBeUndefined();
    });

    it('skips requests starting with /node_modules', async () => {
      const req = makeReq({ url: '/node_modules/lit/lit.js' });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
      expect((req as any).nkAuth).toBeUndefined();
    });

    it('skips requests with a file extension', async () => {
      for (const url of ['/app.js', '/styles.css', '/image.png']) {
        const req = makeReq({ url });
        const next = vi.fn();
        await middleware(req, makeRes(), next);
        expect(next).toHaveBeenCalledOnce();
      }
    });

    it('does NOT skip normal page routes', async () => {
      const next = vi.fn();
      await middleware(makeReq({ url: '/dashboard' }), makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
      expect((makeReq({ url: '/dashboard' }) as any).nkAuth).toBeUndefined();
    });

    it('does NOT skip root route', async () => {
      const req = makeReq({ url: '/' });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
      expect((req as any).nkAuth).toBeNull();
    });
  });

  // ── No credentials ──────────────────────────────────────────

  describe('no credentials', () => {
    it('sets nkAuth = null and calls next when no cookie or auth header', async () => {
      const req = makeReq({ url: '/page' });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect((req as any).nkAuth).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  // ── Bearer token auth ───────────────────────────────────────

  describe('bearer token auth', () => {
    it('sets nkAuth with verified user on valid bearer token', async () => {
      vi.mocked(verifyAccessToken).mockReturnValue(fakeUser);
      const req = makeReq({ url: '/api', headers: { authorization: 'Bearer valid-token' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect(verifyAccessToken).toHaveBeenCalledWith('valid-token', baseConfig.session.secret);
      const auth = (req as any).nkAuth as NkAuth;
      expect(auth.user).toEqual(fakeUser);
      expect(auth.session.accessToken).toBe('valid-token');
      expect(next).toHaveBeenCalledOnce();
    });

    it('falls through to cookie auth when bearer token is invalid', async () => {
      vi.mocked(verifyAccessToken).mockReturnValue(null);
      const req = makeReq({ url: '/page', headers: { authorization: 'Bearer bad-token' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      // Should have tried bearer, failed, then continued (no cookie → nkAuth = null)
      expect((req as any).nkAuth).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    });

    it('falls through when verifyAccessToken throws', async () => {
      vi.mocked(verifyAccessToken).mockImplementation(() => { throw new Error('bad'); });
      const req = makeReq({ url: '/page', headers: { authorization: 'Bearer throws' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect((req as any).nkAuth).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    });

    it('ignores non-Bearer authorization headers', async () => {
      const req = makeReq({ url: '/page', headers: { authorization: 'Basic dXNlcjpwYXNz' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect(verifyAccessToken).not.toHaveBeenCalled();
      expect((req as any).nkAuth).toBeNull();
    });

    it('handles Bearer token with empty string after Bearer', async () => {
      vi.mocked(verifyAccessToken).mockReturnValue(null);
      const req = makeReq({ url: '/page', headers: { authorization: 'Bearer ' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);
      expect(verifyAccessToken).toHaveBeenCalledWith('', baseConfig.session.secret);
      expect((req as any).nkAuth).toBeNull();
    });
  });

  // ── Cookie session auth ─────────────────────────────────────

  describe('cookie session auth', () => {
    it('parses session cookie and sets nkAuth', async () => {
      vi.mocked(parseSessionCookie).mockReturnValue('encrypted-cookie');
      vi.mocked(decryptSession).mockResolvedValue(fakeSession);
      vi.mocked(shouldRefreshSession).mockReturnValue(false);

      const req = makeReq({ url: '/dashboard', headers: { cookie: 'nk_session=encrypted-cookie' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);

      expect(parseSessionCookie).toHaveBeenCalledWith('nk_session=encrypted-cookie', 'nk_session');
      expect(decryptSession).toHaveBeenCalledWith('encrypted-cookie', baseConfig.session.secret);
      const auth = (req as any).nkAuth as NkAuth;
      expect(auth.user).toEqual(fakeUser);
      expect(auth.session).toEqual(fakeSession);
      expect(next).toHaveBeenCalledOnce();
    });

    it('sets nkAuth = null when cookie name does not match', async () => {
      vi.mocked(parseSessionCookie).mockReturnValue(undefined);

      const req = makeReq({ url: '/page', headers: { cookie: 'other=value' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);

      expect((req as any).nkAuth).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    });

    it('sets nkAuth = null on invalid/expired cookie (decryption fails)', async () => {
      vi.mocked(parseSessionCookie).mockReturnValue('bad-encrypted');
      vi.mocked(decryptSession).mockResolvedValue(null);

      const req = makeReq({ url: '/page', headers: { cookie: 'nk_session=bad-encrypted' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);

      expect((req as any).nkAuth).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    });

    it('calls next with nkAuth = null when cookie header is empty string', async () => {
      const req = makeReq({ url: '/page', headers: { cookie: '' } });
      const next = vi.fn();
      await middleware(req, makeRes(), next);

      // Empty string is falsy, so no cookie parsing occurs
      expect(parseSessionCookie).not.toHaveBeenCalled();
      expect((req as any).nkAuth).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  // ── OIDC token refresh ──────────────────────────────────────

  describe('OIDC token refresh', () => {
    const refreshedUser: AuthUser = { sub: 'u1', email: 'a@b.com', name: 'Alice Updated', roles: ['user'], provider: 'keycloak' };

    function setupSessionWithRefresh(session: SessionData) {
      vi.mocked(parseSessionCookie).mockReturnValue('enc');
      vi.mocked(decryptSession).mockResolvedValue(session);
      vi.mocked(shouldRefreshSession).mockReturnValue(true);
    }

    it('refreshes tokens when shouldRefreshSession returns true', async () => {
      setupSessionWithRefresh(fakeSession);
      vi.mocked(discoverProvider).mockResolvedValue({ token_endpoint: 'https://idp.test/token' } as any);
      vi.mocked(refreshTokens).mockResolvedValue({
        access_token: 'new-at', refresh_token: 'new-rt', id_token: 'new-idt', expires_in: 3600, token_type: 'Bearer',
      });
      vi.mocked(extractUser).mockReturnValue({ ...refreshedUser, provider: undefined });
      vi.mocked(encryptSession).mockResolvedValue('new-encrypted');
      vi.mocked(createSessionCookie).mockReturnValue('nk_session=new-encrypted; HttpOnly');

      const req = makeReq({ url: '/page', headers: { cookie: 'nk_session=enc' } });
      const res = makeRes();
      const next = vi.fn();
      await middleware(req, res, next);

      expect(discoverProvider).toHaveBeenCalledWith('https://idp.test');
      expect(refreshTokens).toHaveBeenCalledWith(
        { token_endpoint: 'https://idp.test/token' }, 'app', 's3cret', 'rt',
      );
      expect(res._headers['Set-Cookie']).toBe('nk_session=new-encrypted; HttpOnly');

      const auth = (req as any).nkAuth as NkAuth;
      expect(auth.session.accessToken).toBe('new-at');
      expect(auth.session.refreshToken).toBe('new-rt');
      expect(auth.user.provider).toBe('keycloak');
      expect(next).toHaveBeenCalledOnce();
    });

    it('updates Set-Cookie header with new encrypted session', async () => {
      setupSessionWithRefresh(fakeSession);
      vi.mocked(discoverProvider).mockResolvedValue({} as any);
      vi.mocked(refreshTokens).mockResolvedValue({
        access_token: 'at2', refresh_token: undefined, id_token: undefined, expires_in: 1800, token_type: 'Bearer',
      });
      vi.mocked(extractUser).mockReturnValue({ sub: 'u1', roles: [] } as any);
      vi.mocked(encryptSession).mockResolvedValue('encrypted2');
      vi.mocked(createSessionCookie).mockReturnValue('cookie-val');

      const res = makeRes();
      await middleware(makeReq({ url: '/p', headers: { cookie: 'c' } }), res, vi.fn());

      expect(encryptSession).toHaveBeenCalled();
      expect(createSessionCookie).toHaveBeenCalledWith('nk_session', 'encrypted2', 86400, false);
      expect(res._headers['Set-Cookie']).toBe('cookie-val');
    });

    it('falls back to existing refreshToken when new one is absent', async () => {
      setupSessionWithRefresh(fakeSession);
      vi.mocked(discoverProvider).mockResolvedValue({} as any);
      vi.mocked(refreshTokens).mockResolvedValue({
        access_token: 'at3', refresh_token: undefined, id_token: undefined, expires_in: 1800, token_type: 'Bearer',
      });
      vi.mocked(extractUser).mockReturnValue({ sub: 'u1', roles: [] } as any);
      vi.mocked(encryptSession).mockResolvedValue('e');
      vi.mocked(createSessionCookie).mockReturnValue('c');

      const req = makeReq({ url: '/p', headers: { cookie: 'c' } });
      await middleware(req, makeRes(), vi.fn());

      const sessionArg = vi.mocked(encryptSession).mock.calls[0][0];
      expect(sessionArg.refreshToken).toBe('rt'); // kept from original session
    });

    it('skips refresh for native provider sessions', async () => {
      const nativeSession: SessionData = { ...fakeSession, provider: 'native', refreshToken: 'rt' };
      vi.mocked(parseSessionCookie).mockReturnValue('enc');
      vi.mocked(decryptSession).mockResolvedValue(nativeSession);
      vi.mocked(shouldRefreshSession).mockReturnValue(true);

      const req = makeReq({ url: '/page', headers: { cookie: 'nk_session=enc' } });
      await middleware(req, makeRes(), vi.fn());

      expect(discoverProvider).not.toHaveBeenCalled();
      const auth = (req as any).nkAuth as NkAuth;
      expect(auth.session).toEqual(nativeSession);
    });

    it('keeps existing session when refresh fails', async () => {
      setupSessionWithRefresh(fakeSession);
      vi.mocked(discoverProvider).mockRejectedValue(new Error('network'));

      const req = makeReq({ url: '/page', headers: { cookie: 'nk_session=enc' } });
      const res = makeRes();
      await middleware(req, res, vi.fn());

      // Should still have the original session
      const auth = (req as any).nkAuth as NkAuth;
      expect(auth.user).toEqual(fakeUser);
      expect(auth.session).toEqual(fakeSession);
      expect(res._headers['Set-Cookie']).toBeUndefined();
    });

    it('skips refresh when no matching OIDC provider is found', async () => {
      const unknownSession: SessionData = { ...fakeSession, provider: 'unknown-provider' };
      vi.mocked(parseSessionCookie).mockReturnValue('enc');
      vi.mocked(decryptSession).mockResolvedValue(unknownSession);
      vi.mocked(shouldRefreshSession).mockReturnValue(true);

      const req = makeReq({ url: '/page', headers: { cookie: 'c' } });
      await middleware(req, makeRes(), vi.fn());

      expect(discoverProvider).not.toHaveBeenCalled();
      const auth = (req as any).nkAuth as NkAuth;
      expect(auth.session).toEqual(unknownSession);
    });

    it('skips refresh when session has no refreshToken', async () => {
      const noRefresh: SessionData = { ...fakeSession, refreshToken: undefined };
      vi.mocked(parseSessionCookie).mockReturnValue('enc');
      vi.mocked(decryptSession).mockResolvedValue(noRefresh);
      vi.mocked(shouldRefreshSession).mockReturnValue(true);

      const req = makeReq({ url: '/page', headers: { cookie: 'c' } });
      await middleware(req, makeRes(), vi.fn());

      expect(discoverProvider).not.toHaveBeenCalled();
    });

    it('skips refresh when shouldRefreshSession returns false', async () => {
      vi.mocked(parseSessionCookie).mockReturnValue('enc');
      vi.mocked(decryptSession).mockResolvedValue(fakeSession);
      vi.mocked(shouldRefreshSession).mockReturnValue(false);

      const req = makeReq({ url: '/page', headers: { cookie: 'c' } });
      await middleware(req, makeRes(), vi.fn());

      expect(discoverProvider).not.toHaveBeenCalled();
    });
  });
});
