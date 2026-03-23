import { describe, it, expect } from 'vitest';
import { getOidcProvider, getNativeProvider, hasNativeAuth, hasOidcAuth } from './config.js';
import type { ResolvedAuthConfig } from './types.js';

const multiProviderConfig: ResolvedAuthConfig = {
  providers: [
    { type: 'oidc', name: 'keycloak', issuer: 'https://auth.example.com/realms/test', clientId: 'app' },
    { type: 'native', name: 'local' },
  ],
  session: { secret: 'test', cookieName: 'nk-session', maxAge: 604800, secure: false },
  routes: { login: '/__nk_auth/login', callback: '/__nk_auth/callback', logout: '/__nk_auth/logout', signup: '/__nk_auth/signup', postLogin: '/', postLogout: '/' },
  guards: { defaultAuth: false },
};

const oidcOnlyConfig: ResolvedAuthConfig = {
  ...multiProviderConfig,
  providers: [
    { type: 'oidc', name: 'auth0', issuer: 'https://auth0.example.com', clientId: 'app' },
  ],
};

describe('config helpers', () => {
  it('getOidcProvider returns first OIDC provider', () => {
    const p = getOidcProvider(multiProviderConfig);
    expect(p).toBeDefined();
    expect(p!.name).toBe('keycloak');
  });

  it('getNativeProvider returns native provider', () => {
    const p = getNativeProvider(multiProviderConfig);
    expect(p).toBeDefined();
    expect(p!.name).toBe('local');
  });

  it('getNativeProvider returns undefined when no native provider', () => {
    expect(getNativeProvider(oidcOnlyConfig)).toBeUndefined();
  });

  it('hasNativeAuth returns true for multi-provider', () => {
    expect(hasNativeAuth(multiProviderConfig)).toBe(true);
  });

  it('hasNativeAuth returns false for oidc-only', () => {
    expect(hasNativeAuth(oidcOnlyConfig)).toBe(false);
  });

  it('hasOidcAuth returns true when OIDC provider exists', () => {
    expect(hasOidcAuth(multiProviderConfig)).toBe(true);
    expect(hasOidcAuth(oidcOnlyConfig)).toBe(true);
  });
});
