import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ResolvedAuthConfig } from '../types.js';
import { getRedirectProviderByName } from '../config.js';
import { encryptSession, createSessionCookie } from '../session.js';
import { sendJson, readBody, safeReturnTo } from './utils.js';

/**
 * A person's sign-in methods, and adding or removing one.
 *
 * These are the routes a profile screen talks to. All three require a session:
 * an identity belongs to whoever is signed in, and linking a provider attaches
 * it to that account rather than matching by email.
 */

/** GET /__nk_auth/identities — the signed-in user's methods. */
export async function handleListIdentities(
  config: ResolvedAuthConfig, req: IncomingMessage, res: ServerResponse, db?: any,
): Promise<boolean> {
  const user = (req as any).nkAuth?.user;
  if (!user?.sub) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
  if (!db) { sendJson(res, 200, { identities: [] }); return true; }

  const { ensureIdentitiesTable, listIdentities } = await import('../identities.js');
  await ensureIdentitiesTable(db);
  const identities = await listIdentities(db, user.sub);
  // subject is the user's OWN data (their id at the provider); safe to return.
  sendJson(res, 200, {
    identities: identities.map((i) => ({
      provider: i.provider, subject: i.subject, email: i.email,
      emailVerified: i.emailVerified, linkedAt: i.linkedAt, lastLoginAt: i.lastLoginAt,
    })),
  });
  return true;
}

/**
 * GET /__nk_auth/link/<provider> — start attaching a provider to THIS account.
 *
 * The same redirect the login uses, but the state cookie carries mode:'link'
 * and the signed-in user's id, so the callback records an identity against the
 * existing account instead of resolving a user by email. An old in-flight
 * cookie lacks `mode` and is treated as a login — backward compatible.
 */
export async function handleStartLink(
  config: ResolvedAuthConfig, req: IncomingMessage, res: ServerResponse, url: URL, providerName: string,
): Promise<boolean> {
  const user = (req as any).nkAuth?.user;
  if (!user?.sub) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }

  const provider = getRedirectProviderByName(config, providerName);
  if (!provider) { sendJson(res, 404, { error: `Unknown provider "${providerName}"` }); return true; }

  const state = crypto.randomBytes(16).toString('hex');
  const { generateCodeVerifier } = await import('../oidc-client.js');
  const codeVerifier = generateCodeVerifier();
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), config.routes.postLogin);
  const redirectUri = `${url.origin}${config.routes.callback}`;

  const stateData = JSON.stringify({
    state, codeVerifier, returnTo, provider: provider.name, mode: 'link', linkUserId: user.sub,
  });
  const encrypted = await encryptSession(
    { accessToken: stateData, expiresAt: Math.floor(Date.now() / 1000) + 600, user: { sub: '', roles: [] } },
    config.session.secret,
  );
  const stateCookie = createSessionCookie('nk-auth-state', encrypted, 600, config.session.secure);

  let authUrl: string;
  if (provider.type === 'oauth2') {
    const { buildOAuth2AuthorizationUrl } = await import('../oauth2-client.js');
    authUrl = buildOAuth2AuthorizationUrl(provider, redirectUri, state, codeVerifier);
  } else {
    const { discoverProvider, buildAuthorizationUrl } = await import('../oidc-client.js');
    const metadata = await discoverProvider(provider.issuer);
    authUrl = buildAuthorizationUrl(
      metadata, provider.clientId, redirectUri,
      provider.scopes || ['openid', 'profile', 'email'], state, codeVerifier);
  }

  res.writeHead(302, { Location: authUrl, 'Set-Cookie': stateCookie });
  res.end();
  return true;
}

/** POST /__nk_auth/identities/unlink { provider } — remove a linked method. */
export async function handleUnlinkIdentity(
  config: ResolvedAuthConfig, req: IncomingMessage, res: ServerResponse, db?: any,
): Promise<boolean> {
  const user = (req as any).nkAuth?.user;
  if (!user?.sub) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
  if (!db) { sendJson(res, 500, { error: 'No database' }); return true; }

  const body = await readBody(req);
  let provider: string | undefined;
  try { provider = JSON.parse(body).provider; } catch {}
  if (!provider) { sendJson(res, 400, { error: 'provider is required' }); return true; }

  const { ensureIdentitiesTable, unlinkIdentity } = await import('../identities.js');
  await ensureIdentitiesTable(db);
  const result = await unlinkIdentity(db, user.sub, provider);
  if (result.ok) {
    if (config.onEvent) {
      try { await config.onEvent({ type: 'identity-unlinked', email: user.email ?? '', userId: user.sub, provider }); } catch {}
    }
    sendJson(res, 200, { ok: true });
  } else if (result.reason === 'not-found') {
    sendJson(res, 404, { error: `No "${provider}" identity on this account` });
  } else {
    // last-method: removing it would leave the account unreachable.
    sendJson(res, 409, { error: 'Cannot remove your only sign-in method' });
  }
  return true;
}
