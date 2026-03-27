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

function validate(config: any): ResolvedAuthConfig {
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
    if (p.type === 'oidc') {
      if (!p.issuer) throw new Error(`[LumenJS Auth] Provider "${p.name}": issuer is required`);
      if (!p.clientId) throw new Error(`[LumenJS Auth] Provider "${p.name}": clientId is required`);
    }
    if (!p.name) throw new Error('[LumenJS Auth] Each provider must have a name');
  }

  return {
    providers,
    session: {
      secret: config.session.secret,
      cookieName: config.session.cookieName || 'nk-session',
      maxAge: config.session.maxAge || 60 * 60 * 24 * 7,
      secure: config.session.secure ?? false,
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
