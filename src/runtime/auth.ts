/**
 * Client-side auth store — singleton following the i18n.ts pattern.
 * Hydrated from __nk_auth__ script tag on page load.
 */

let currentUser: any = null;
let initialized = false;

export function getUser(): any {
  return currentUser;
}

export function isAuthenticated(): boolean {
  return currentUser !== null;
}

export function hasRole(role: string): boolean {
  return currentUser?.roles?.includes(role) ?? false;
}

export function initAuth(user: any): void {
  currentUser = user;
  initialized = true;
}

export function login(returnTo?: string): void {
  const url = new URL('/__nk_auth/login', location.origin);
  if (returnTo) url.searchParams.set('returnTo', returnTo);
  location.href = url.toString();
}

export function logout(): void {
  currentUser = null;
  initialized = false;
  location.href = '/__nk_auth/logout';
}
