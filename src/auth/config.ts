import path from 'path';
import type { AuthConfig, ResolvedAuthConfig, AuthProvider } from './types.js';

const ROUTE_DEFAULTS = {
  login: '/__nk_auth/login',
  loginPage: '/auth/login',
  callback: '/__nk_auth/callback',
  logout: '/__nk_auth/logout',
  signup: '/__nk_auth/signup',
  postLogin: '/',
  postLogout: '/',
};

const GUARD_DEFAULTS = {
  defaultAuth: false,
};

const PERMISSIONS_DEFAULTS = {
  enabled: false,
  defaultOwnerGrants: ['read', 'write', 'delete', 'share'],
};

const TOKEN_DEFAULTS = {
  enabled: true,
  accessTokenTTL: 900,
  refreshTokenTTL: 604800,
};

export function validate(config: any): ResolvedAuthConfig {
  if (!config?.session?.secret) throw new Error('[LumenJS Auth] session.secret is required');

  // Normalize providers: support both legacy single-provider and multi-provider
  let providers: AuthProvider[];

  if (config.providers && Array.isArray(config.providers)) {
    providers = config.providers;
  } else if (config.provider?.issuer) {
    // Legacy single OIDC provider format
    providers = [{
      type: 'oidc',
      name: 'default',
      issuer: config.provider.issuer,
      clientId: config.provider.clientId,
      clientSecret: config.provider.clientSecret,
      scopes: config.provider.scopes || ['openid', 'profile', 'email'],
    }];
  } else {
    throw new Error('[LumenJS Auth] Either providers[] or provider.issuer is required');
  }

  // Validate each provider
  for (const p of providers) {
    if (!p.name) throw new Error('[LumenJS Auth] Each provider must have a name');
    if (p.type === 'oidc') {
      if (!p.issuer) throw new Error(`[LumenJS Auth] Provider "${p.name}": issuer is required`);
      if (!p.clientId) throw new Error(`[LumenJS Auth] Provider "${p.name}": clientId is required`);
    } else if (p.type === 'oauth2') {
      for (const k of ['authorizeUrl', 'tokenUrl', 'userInfoUrl', 'clientId'] as const) {
        if (!(p as any)[k]) throw new Error(`[LumenJS Auth] Provider "${p.name}": ${k} is required`);
      }
      if (typeof (p as any).mapUser !== 'function') {
        throw new Error(`[LumenJS Auth] Provider "${p.name}": mapUser is required`);
      }
    } else if (p.type !== 'native') {
      // Unknown types were silently accepted before; warn rather than throw so
      // an app is not bricked by an upgrade, but no longer entirely silent.
      console.warn(`[LumenJS Auth] Provider "${(p as any).name}": unknown type "${(p as any).type}"`);
    }
  }

  return {
    providers,
    session: {
      secret: config.session.secret,
      cookieName: config.session.cookieName || 'nk-session',
      maxAge: config.session.maxAge || 60 * 60 * 24 * 7,
      secure: config.session.secure ?? (process.env.NODE_ENV === 'production'),
    },
    routes: { ...ROUTE_DEFAULTS, ...config.routes },
    guards: { ...GUARD_DEFAULTS, ...config.guards },
    permissions: { ...PERMISSIONS_DEFAULTS, ...config.permissions },
    token: { ...TOKEN_DEFAULTS, ...config.token },
    ...(config.onEvent ? { onEvent: config.onEvent } : {}),
  };
}

/** Get a provider by name */
export function getProvider(config: ResolvedAuthConfig, name: string): AuthProvider | undefined {
  return config.providers.find(p => p.name === name);
}

/** Get the first OIDC provider */
export function getOidcProvider(config: ResolvedAuthConfig) {
  return config.providers.find(p => p.type === 'oidc') as (AuthProvider & { type: 'oidc' }) | undefined;
}

/** Get the native provider */
export function getNativeProvider(config: ResolvedAuthConfig) {
  return config.providers.find(p => p.type === 'native') as (AuthProvider & { type: 'native' }) | undefined;
}

/** Check if config has a native auth provider */
export function hasNativeAuth(config: ResolvedAuthConfig): boolean {
  return config.providers.some(p => p.type === 'native');
}

/** Check if config has any OIDC provider */
export function hasOidcAuth(config: ResolvedAuthConfig): boolean {
  return config.providers.some(p => p.type === 'oidc');
}

/** The first provider that uses a browser redirect flow — oidc or oauth2. */
export function getRedirectProvider(config: ResolvedAuthConfig) {
  return config.providers.find(p => p.type === 'oidc' || p.type === 'oauth2') as
    (import('./types.js').OIDCProvider | import('./types.js').OAuth2Provider) | undefined;
}

/** A redirect provider by name. */
export function getRedirectProviderByName(config: ResolvedAuthConfig, name: string) {
  return config.providers.find(p => (p.type === 'oidc' || p.type === 'oauth2') && p.name === name) as
    (import('./types.js').OIDCProvider | import('./types.js').OAuth2Provider) | undefined;
}

/**
 * Load auth config in dev mode (via Vite's ssrLoadModule).
 */
export async function loadAuthConfig(
  projectDir: string,
  ssrLoadModule?: (id: string) => Promise<any>,
): Promise<ResolvedAuthConfig | null> {
  try {
    if (ssrLoadModule) {
      const mod = await ssrLoadModule(path.join(projectDir, 'lumenjs.auth.ts'));
      return validate(mod.default || mod);
    }
    const mod = await import(path.join(projectDir, 'lumenjs.auth.ts'));
    return validate(mod.default || mod);
  } catch (err: any) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Load auth config in production from bundled server output.
 */
export async function loadAuthConfigProd(serverDir: string, configModule: string): Promise<ResolvedAuthConfig> {
  const mod = await import(path.join(serverDir, configModule));
  return validate(mod.default || mod);
}
