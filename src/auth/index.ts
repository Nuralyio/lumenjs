export { googleProvider } from './providers/google.js';
export type { GoogleProviderOptions } from './providers/google.js';
export { githubProvider, githubMapUser } from './providers/github.js';
export type { GitHubProviderOptions } from './providers/github.js';
export {
  ensureIdentitiesTable,
  findUserIdByIdentity,
  recordIdentity,
  listIdentities,
  unlinkIdentity,
  IdentityConflictError,
} from './identities.js';
export type { AuthIdentity } from './identities.js';

export type {
  AuthConfig,
  AuthUser,
  AuthProvider,
  AuthEvent,
  OIDCProvider,
  NativeProvider,
  OAuth2Provider,
  OAuth2UserContext,
  OAuth2TokenSet,
  ResolvedAuthConfig,
  SessionData,
  NkAuth,
  TokenResponse,
} from './types.js';
