import type { AuthUser, OAuth2Provider, OAuth2UserContext } from '../types.js';

export interface GitHubProviderOptions {
  clientId: string;
  /** Required — GitHub OAuth apps have no public-client (secretless) flow. */
  clientSecret: string;
  /** Merged onto ['read:user', 'user:email']. */
  scopes?: string[];
  /** Sent as User-Agent; GitHub 403s API calls that have none. */
  appName?: string;
}

/**
 * Pre-configured GitHub OAuth2 provider. GitHub is not OIDC (no discovery, no
 * id_token, opaque token, identity behind two API calls), so it is an
 * OAuth2Provider and its verified-email resolution lives in mapUser.
 *
 * @example
 * // lumenjs.auth.ts
 * import { githubProvider } from '@nuraly/lumenjs/dist/auth/providers/github.js';
 * export default {
 *   providers: [githubProvider({ clientId: '...', clientSecret: '...' })],
 *   session: { secret: process.env.SESSION_SECRET! },
 * };
 */
export function githubProvider(opts: GitHubProviderOptions): OAuth2Provider {
  const scopes = ['read:user', 'user:email', ...(opts.scopes ?? [])];
  return {
    type: 'oauth2',
    name: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    scopes: [...new Set(scopes)],
    apiHeaders: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': opts.appName ?? 'lumenjs',
    },
    mapUser: githubMapUser,
  };
}

/**
 * GitHub's /user JSON to an AuthUser. `profile.email` is the PUBLIC email and
 * is not proof of control, so email_verified is true only from a
 * `primary && verified` entry in /user/emails — an optimistic verified:true
 * would be an account-takeover vector.
 */
export async function githubMapUser(profile: Record<string, any>, ctx: OAuth2UserContext): Promise<AuthUser> {
  let email: string | undefined = profile.email ?? undefined;
  let emailVerified = false;

  try {
    const emails = await ctx.fetchJson('https://api.github.com/user/emails');
    if (Array.isArray(emails)) {
      const primary = emails.find((e: any) => e?.primary && e?.verified)
        ?? emails.find((e: any) => e?.verified);
      if (primary?.email) {
        email = primary.email;
        emailVerified = true;
      }
    }
  } catch {
    // No user:email scope or the call failed — leave the email unverified, not trusted.
  }

  return {
    sub: String(profile.id),                    // the numeric id — logins are renameable
    email,
    name: profile.name || profile.login,
    preferred_username: profile.login,
    roles: [],
    email_verified: emailVerified,
  } as AuthUser;
}
