/**
 * The OAuth2 half of the redirect flow, for providers with no OIDC discovery.
 *
 * Deliberately separate from oidc-client.ts: the OIDC path decodes a signed
 * id_token and validates its claims; this one has no id_token at all and asks
 * the provider's userinfo endpoint instead. Keeping them apart means adding
 * GitHub changed no line an OIDC login runs.
 *
 * PKCE helpers are reused from oidc-client — the mechanism is identical.
 */
import { generateCodeChallenge } from './oidc-client.js';
import type { AuthUser, OAuth2Provider, OAuth2TokenSet } from './types.js';

export function buildOAuth2AuthorizationUrl(
  p: OAuth2Provider,
  redirectUri: string,
  state: string,
  codeVerifier: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: redirectUri,
    scope: (p.scopes ?? []).join(' '),
    state,
  });
  if (p.pkce !== false) {
    params.set('code_challenge', generateCodeChallenge(codeVerifier));
    params.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(p.authorizeParams ?? {})) params.set(k, v);
  return `${p.authorizeUrl}?${params}`;
}

/**
 * The code-for-token exchange.
 *
 * `Accept: application/json` is the one header the OIDC version omits and this
 * one must send: without it GitHub replies `application/x-www-form-urlencoded`,
 * and a bare `res.json()` throws. We sniff the response content type and parse
 * either form, so a provider that ignores the Accept header still works.
 */
export async function exchangeOAuth2Code(
  p: OAuth2Provider,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<OAuth2TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: p.clientId,
    code,
    redirect_uri: redirectUri,
  });
  if (p.pkce !== false) body.set('code_verifier', codeVerifier);
  if (p.clientSecret) body.set('client_secret', p.clientSecret);

  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      ...(p.apiHeaders ?? {}),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth2 token exchange failed: ${res.status} ${err}`);
  }

  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json') || text.trim().startsWith('{')) {
    return JSON.parse(text) as OAuth2TokenSet;
  }
  // Form-encoded fallback (GitHub without the Accept header honoured).
  const parsed = Object.fromEntries(new URLSearchParams(text));
  if (!parsed.access_token) throw new Error(`OAuth2 token response had no access_token: ${text.slice(0, 120)}`);
  return parsed as unknown as OAuth2TokenSet;
}

/** A JSON-fetcher bound to this provider's token and headers — the thing a
 *  mapUser calls for its follow-up requests. */
export function createFetchJson(p: OAuth2Provider, accessToken: string): (url: string) => Promise<any> {
  return async (url: string) => {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        ...(p.apiHeaders ?? {}),
      },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OAuth2 API call failed: ${res.status} ${err}`);
    }
    return res.json();
  };
}

/** Fetch the profile and run the provider's mapUser, then force provider name
 *  and default roles — the two things a mapper should not have to remember. */
export async function resolveOAuth2User(p: OAuth2Provider, tokens: OAuth2TokenSet): Promise<AuthUser> {
  const fetchJson = createFetchJson(p, tokens.access_token);
  const profile = await fetchJson(p.userInfoUrl);
  const user = await p.mapUser(profile, { accessToken: tokens.access_token, fetchJson });
  return { ...user, provider: p.name, roles: user.roles ?? [] };
}
