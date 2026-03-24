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

export type AuthProvider = OIDCProvider | NativeProvider;

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
