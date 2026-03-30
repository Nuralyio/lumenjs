import type { AuthUser } from '../auth/types.js';
import type { PermissionService } from './service.js';

export type GuardResult =
  | { allowed: true }
  | { redirect: string }
  | { forbidden: true };

/**
 * Enforce a permission guard on a page.
 *
 * Called when a page exports:
 *   export const auth = { permission: 'workflow:read', resourceParam: 'workflowId' };
 *
 * Checks authentication first, then resource-level permission.
 */
export async function enforcePermissionGuard(
  authExport: { permission: string; resourceParam: string },
  user: AuthUser | null | undefined,
  loginUrl: string,
  pathname: string,
  urlParams: Record<string, string>,
  permissionService: PermissionService,
): Promise<GuardResult> {
  // Must be authenticated
  if (!user) {
    return { redirect: `${loginUrl}?returnTo=${encodeURIComponent(pathname)}` };
  }

  const resourceId = urlParams[authExport.resourceParam];
  if (!resourceId) {
    return { allowed: true };
  }

  const [resourceType] = authExport.permission.split(':');

  const hasPermission = await permissionService.canAccess(
    user.sub,
    authExport.permission,
    resourceType,
    resourceId,
  );

  if (!hasPermission) {
    return { forbidden: true };
  }

  return { allowed: true };
}

/**
 * Check if an auth export contains a permission guard (has 'permission' field).
 */
export function isPermissionGuard(authExport: any): authExport is { permission: string; resourceParam: string } {
  return authExport && typeof authExport === 'object' && typeof authExport.permission === 'string';
}
