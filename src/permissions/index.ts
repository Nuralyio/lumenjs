export { PermissionService, usePermissions } from './service.js';
export type { AuditLogEntry } from './service.js';
export { ensurePermissionTables } from './tables.js';
export { enforcePermissionGuard, isPermissionGuard } from './guard.js';
export type { GuardResult } from './guard.js';
export type {
  ResourcePermission,
  Role,
  UserRole,
  PermissionsConfig,
  ResolvedPermissionsConfig,
} from './types.js';
