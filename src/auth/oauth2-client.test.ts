import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildOAuth2AuthorizationUrl, exchangeOAuth2Code } from './oauth2-client.js';
import type { OAuth2Provider } from './types.js';

const base: OAuth2Provider = {
  type: 'oauth2', name: 'test',
  authorizeUrl: 'https://p.co/authorize',
  tokenUrl: 'https://p.co/token',
  userInfoUrl: 'https://p.co/user',
  clientId: 'cid', clientSecret: 'sec',
  scopes: ['read'],
  mapUser: (p) => ({ sub: String(p.id), roles: [] } as any),
};

describe('buildOAuth2AuthorizationUrl', () => {
  it('sends PKCE by default', () => {
    const u = new URL(buildOAuth2AuthorizationUrl(base, 'https://app/cb', 'st', 'ver'));
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('st');
  });

  it('omits PKCE when the provider opts out', () => {
    const u = new URL(buildOAuth2AuthorizationUrl({ ...base, pkce: false }, 'https://app/cb', 'st', 'ver'));
    expect(u.searchParams.get('code_challenge')).toBeNull();
  });

  it('appends static authorizeParams', () => {
    const u = new URL(buildOAuth2AuthorizationUrl(
      { ...base, authorizeParams: { allow_signup: 'false' } }, 'https://app/cb', 'st', 'ver'));
    expect(u.searchParams.get('allow_signup')).toBe('false');
  });
});

describe('exchangeOAuth2Code', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends Accept: application/json — the header GitHub needs', async () => {
    const seen: any = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      seen.headers = init.headers;
      return { ok: true, headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ access_token: 'tok' }) } as any;
    }));
    const tokens = await exchangeOAuth2Code(base, 'code', 'https://app/cb', 'ver');
    expect(tokens.access_token).toBe('tok');
    expect(seen.headers['Accept']).toBe('application/json');
  });

  it('parses a form-encoded reply when the provider ignores Accept', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Map([['content-type', 'application/x-www-form-urlencoded']]),
      text: async () => 'access_token=tok&scope=read&token_type=bearer',
    } as any)));
    const tokens = await exchangeOAuth2Code(base, 'code', 'https://app/cb', 'ver');
    expect(tokens.access_token).toBe('tok');
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad' } as any)));
    await expect(exchangeOAuth2Code(base, 'code', 'https://app/cb', 'ver')).rejects.toThrow(/401/);
  });
});
