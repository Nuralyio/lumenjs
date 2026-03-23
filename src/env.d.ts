declare module 'virtual:lumenjs-routes' {
  export const routes: Array<{ path: string; tagName: string }>;
}

declare module '@lumenjs/auth' {
  export function getUser(): any;
  export function isAuthenticated(): boolean;
  export function hasRole(role: string): boolean;
  export function initAuth(user: any): void;
  export function login(returnTo?: string): void;
  export function logout(): void;
}

declare module '@nuraly/lumenjs-auth' {
  export function getUser(): any;
  export function isAuthenticated(): boolean;
  export function hasRole(role: string): boolean;
  export function initAuth(user: any): void;
  export function login(returnTo?: string): void;
  export function logout(): void;
}
