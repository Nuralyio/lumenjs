export interface AuthConfig {
  provider: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string[];
  };
  session: {
    secret: string;
    cookieName?: string;
    maxAge?: number;
    secure?: boolean;
  };
  routes?: {
    login?: string;
    callback?: string;
    logout?: string;
    postLogout?: string;
    me?: string;
  };
  guards?: {
    defaultAuth?: boolean;
  };
}

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  roles: string[];
  [key: string]: unknown;
}

export interface SessionData {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  user: AuthUser;
}

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

export interface NkAuth {
  user: AuthUser;
  session: SessionData;
}
