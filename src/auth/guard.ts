import type { NkAuth } from './types.js';

export type GuardResult =
  | { allowed: true }
  | { redirect: string }
  | { forbidden: true };

/**
 * Enforce auth guard — pure function, caller handles the HTTP response.
 */
export function enforceGuard(
  authExport: any,
  nkAuth: NkAuth | null | undefined,
  loginUrl: string,
  pathname: string,
): GuardResult {
  if (!authExport) return { allowed: true };

  const user = nkAuth?.user;

  // auth = true → require any authenticated user
  if (authExport === true) {
    if (!user) {
      return { redirect: `${loginUrl}?returnTo=${encodeURIComponent(pathname)}` };
    }
    return { allowed: true };
  }

  // auth = { roles: [...] } → require specific roles
  if (authExport.roles && Array.isArray(authExport.roles)) {
    if (!user) {
      return { redirect: `${loginUrl}?returnTo=${encodeURIComponent(pathname)}` };
    }
    const userRoles: string[] = user.roles || [];
    const hasRole = authExport.roles.some((r: string) => userRoles.includes(r));
    if (!hasRole) {
      return { forbidden: true };
    }
    return { allowed: true };
  }

  return { allowed: true };
}
