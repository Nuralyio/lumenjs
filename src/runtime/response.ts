/**
 * Redirect from a loader function.
 *
 * Usage:
 *   export async function loader({ headers }) {
 *     const user = headers['x-user'];
 *     if (!user) return redirect('/login');
 *     return { user: JSON.parse(user) };
 *   }
 */
export function redirect(location: string, status: number = 302) {
  return { __nk_redirect: true as const, location, status };
}
