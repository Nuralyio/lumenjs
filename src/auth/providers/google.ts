import type { OIDCProvider } from '../types.js';

export interface GoogleProviderOptions {
  clientId: string;
  clientSecret?: string;
  /** Extra scopes beyond openid, profile, email. */
  scopes?: string[];
}

/**
 * Pre-configured Google OIDC provider.
 *
 * Google publishes a standard OIDC discovery document at
 * https://accounts.google.com/.well-known/openid-configuration
 * so no manual endpoint config is needed.
 *
 * @example
 * // lumenjs.auth.ts
 * import { googleProvider } from '@nuraly/lumenjs/dist/auth/providers/google.js';
 * export default {
 *   providers: [googleProvider({ clientId: process.env.GOOGLE_CLIENT_ID! })],
 *   session: { secret: process.env.SESSION_SECRET! },
 * };
 */
export function googleProvider(opts: GoogleProviderOptions): OIDCProvider {
  return {
    type: 'oidc',
    name: 'google',
    issuer: 'https://accounts.google.com',
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    scopes: ['openid', 'profile', 'email', ...(opts.scopes ?? [])],
  };
}
