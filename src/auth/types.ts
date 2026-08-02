// ── Provider Configs ──────────────────────────────────────────────

export interface OIDCProvider {
  type: 'oidc';
  name: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
}

export interface NativeProvider {
  type: 'native';
  name: string;
  /** Minimum password length. Default: 8 */
  minPasswordLength?: number;
  /** Allow user registration. Default: true */
  allowRegistration?: boolean;
  /** Require email verification before login. Default: false */
  requireEmailVerification?: boolean;
}

/** Auth event types for hooks (email sending, logging, etc.) */
export type AuthEvent =
  | { type: 'verification-email'; email: string; token: string; url: string }
  | { type: 'password-reset'; email: string; token: string; url: string }
  | { type: 'password-changed'; email: string; userId: string };

/** Context handed to an OAuth2 provider's mapUser, so the mapper can make the
 *  provider-specific follow-up calls a plain OAuth2 flow needs (GitHub's
 *  /user/emails, for one) without the framework knowing about any of them. */
export interface OAuth2UserContext {
  accessToken: string;
  /** GET a JSON resource from the provider, token and provider headers attached. */
  fetchJson: (url: string) => Promise<any>;
}

/** A provider whose endpoints are DECLARED, not discovered — for OAuth2
 *  services with no OIDC discovery document and no id_token. GitHub is the
 *  reason this exists. */
export interface OAuth2Provider {
  type: 'oauth2';
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  /** Send PKCE. Default true; a provider that rejects code_challenge sets false. */
  pkce?: boolean;
  /** Extra static query params on the authorize URL. */
  authorizeParams?: Record<string, string>;
  /** Extra headers on the token and userinfo requests (GitHub needs User-Agent). */
  apiHeaders?: Record<string, string>;
  /** Map the provider's user JSON to an AuthUser. MUST set email_verified
   *  honestly — the account-linking anti-takeover rule depends on it. */
  mapUser: (profile: Record<string, any>, ctx: OAuth2UserContext) => AuthUser | Promise<AuthUser>;
}

export type AuthProvider = OIDCProvider | NativeProvider | OAuth2Provider;

/** Like TokenSet, but expires_in is optional — a GitHub OAuth app omits it. */
export interface OAuth2TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

// ── Auth Config ──────────────────────────────────────────────────

export interface AuthConfig {
  /** Single provider (legacy) or array of providers */
  provider?: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string[];
  };
  /** Multi-provider config (preferred) */
  providers?: AuthProvider[];
  session: {
    secret: string;
    cookieName?: string;
    maxAge?: number;
    secure?: boolean;
  };
  routes?: {
    login?: string;
    loginPage?: string;
    callback?: string;
    logout?: string;
    signup?: string;
    postLogin?: string;
    postLogout?: string;
    me?: string;
  };
  guards?: {
    defaultAuth?: boolean;
  };
  permissions?: {
    enabled?: boolean;
    defaultOwnerGrants?: string[];
  };
  token?: {
    enabled?: boolean;
    /** Access token TTL in seconds. Default: 900 (15 min) */
    accessTokenTTL?: number;
    /** Refresh token TTL in seconds. Default: 604800 (7 days) */
    refreshTokenTTL?: number;
  };
  /** Hook called for auth events (send verification emails, password reset emails, etc.) */
  onEvent?: (event: AuthEvent) => void | Promise<void>;
}

// ── Resolved Config (internal, after validation) ─────────────────

export interface ResolvedAuthConfig {
  providers: AuthProvider[];
  session: {
    secret: string;
    cookieName: string;
    maxAge: number;
    secure: boolean;
  };
  routes: {
    login: string;
    loginPage: string;
    callback: string;
    logout: string;
    signup: string;
    postLogin: string;
    postLogout: string;
  };
  guards: {
    defaultAuth: boolean;
  };
  permissions: {
    enabled: boolean;
    defaultOwnerGrants: string[];
  };
  token: {
    enabled: boolean;
    accessTokenTTL: number;
    refreshTokenTTL: number;
  };
  onEvent?: (event: AuthEvent) => void | Promise<void>;
}

// ── Token Response ───────────────────────────────────────────────

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: AuthUser;
}

// ── User & Session ───────────────────────────────────────────────

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  roles: string[];
  /** Which provider authenticated this user */
  provider?: string;
  [key: string]: unknown;
}

export interface SessionData {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  user: AuthUser;
  /** Which provider created this session */
  provider?: string;
  /** Epoch seconds when session was created — used for logout-all invalidation */
  createdAt?: number;
}

export interface NkAuth {
  user: AuthUser;
  session: SessionData;
}

// ── OIDC Types ───────────────────────────────────────────────────

export interface OIDCMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri: string;
  issuer: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}
