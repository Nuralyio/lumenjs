import { describe, it, expect, vi } from 'vitest';
import { githubProvider, githubMapUser } from './github.js';
import type { OAuth2UserContext } from '../types.js';

const profile = { id: 4823, login: 'ada', name: 'Ada Lovelace', email: 'public@profile.co' };

function ctx(emails: any): OAuth2UserContext {
  return { accessToken: 'gho_x', fetchJson: vi.fn(async () => emails) };
}

describe('githubProvider', () => {
  it('is an oauth2 provider with GitHub endpoints and the identity scopes', () => {
    const p = githubProvider({ clientId: 'id', clientSecret: 'sec' });
    expect(p.type).toBe('oauth2');
    expect(p.name).toBe('github');
    expect(p.tokenUrl).toBe('https://github.com/login/oauth/access_token');
    expect(p.scopes).toContain('user:email');
    expect(p.apiHeaders?.['User-Agent']).toBeTruthy();  // GitHub 403s without one
  });
});

describe('githubMapUser', () => {
  it('takes the primary verified email and marks it verified', async () => {
    const user = await githubMapUser(profile, ctx([
      { email: 'old@x.co', primary: false, verified: true },
      { email: 'ada@real.co', primary: true, verified: true },
    ]));
    expect(user.email).toBe('ada@real.co');
    expect((user as any).email_verified).toBe(true);
  });

  it('sub is the stringified numeric id, never the login', async () => {
    const user = await githubMapUser(profile, ctx([{ email: 'ada@real.co', primary: true, verified: true }]));
    expect(user.sub).toBe('4823');
    expect((user as any).preferred_username).toBe('ada');
  });

  it('leaves the email unverified when only unverified addresses exist', async () => {
    const user = await githubMapUser(profile, ctx([{ email: 'ada@real.co', primary: true, verified: false }]));
    expect((user as any).email_verified).toBe(false);
  });

  it('leaves the email unverified when /user/emails fails — the takeover guard', async () => {
    const failing: OAuth2UserContext = {
      accessToken: 'gho_x',
      fetchJson: vi.fn(async () => { throw new Error('403 (no user:email scope)'); }),
    };
    const user = await githubMapUser(profile, failing);
    // Falls back to the public profile email but does NOT trust it.
    expect(user.email).toBe('public@profile.co');
    expect((user as any).email_verified).toBe(false);
  });
});
