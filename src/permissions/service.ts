import type { ResourcePermission, ResolvedPermissionsConfig } from './types.js';

const DEFAULT_OWNER_GRANTS = ['read', 'write', 'delete', 'share'];

export interface AuditLogEntry {
  id: number;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  grantee_type: string | null;
  grantee_id: string | null;
  permission: string | null;
  role_id: string | null;
  actor_id: string;
  details: string | null;
  created_at: string;
}

export class PermissionService {
  private config: ResolvedPermissionsConfig;

  constructor(
    private db: any,
    config?: Partial<ResolvedPermissionsConfig>,
  ) {
    this.config = {
      enabled: config?.enabled ?? true,
      defaultOwnerGrants: config?.defaultOwnerGrants ?? DEFAULT_OWNER_GRANTS,
    };
  }

  // ── Audit logging ──────────────────────────────────────────────

  private audit(
    action: string,
    actorId: string,
    opts: {
      resourceType?: string;
      resourceId?: string;
      granteeType?: string;
      granteeId?: string | null;
      permission?: string;
      roleId?: string;
      details?: string;
    } = {},
  ): void {
    this.db.run(
      `INSERT INTO _nk_permission_audit_log
       (action, resource_type, resource_id, grantee_type, grantee_id, permission, role_id, actor_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      action,
      opts.resourceType ?? null,
      opts.resourceId ?? null,
      opts.granteeType ?? null,
      opts.granteeId ?? null,
      opts.permission ?? null,
      opts.roleId ?? null,
      actorId,
      opts.details ?? null,
    );
  }

  /**
   * Query audit log entries.
   */
  getAuditLog(opts?: {
    resourceType?: string;
    resourceId?: string;
    actorId?: string;
    limit?: number;
  }): AuditLogEntry[] {
    let sql = 'SELECT * FROM _nk_permission_audit_log WHERE 1=1';
    const params: any[] = [];

    if (opts?.resourceType) {
      sql += ' AND resource_type = ?';
      params.push(opts.resourceType);
    }
    if (opts?.resourceId) {
      sql += ' AND resource_id = ?';
      params.push(opts.resourceId);
    }
    if (opts?.actorId) {
      sql += ' AND actor_id = ?';
      params.push(opts.actorId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(opts?.limit ?? 100);

    return this.db.all(sql, ...params);
  }

  // ── Permission checks ─────────────────────────────────────────

  /**
   * Check if a user can perform an action on a resource.
   *
   * Check order:
   * 1. Direct user grant
   * 2. Public grant (anyone with the link)
   * 3. Anonymous grant (only if anonymous flag set)
   * 4. Role-based permissions (global roles, then resource-scoped roles)
   * 5. Wildcard '*' permission matches any action
   */
  canAccess(
    userId: string | null,
    permissionType: string,
    resourceType: string,
    resourceId: string,
    anonymous?: boolean,
  ): boolean {
    if (!this.config.enabled) return true;

    const [, action] = permissionType.includes(':')
      ? permissionType.split(':')
      : [resourceType, permissionType];

    // 1. Direct user grant
    if (userId) {
      const userGrant = this.db.get(
        `SELECT 1 FROM _nk_resource_permissions
         WHERE resource_type = ? AND resource_id = ?
           AND grantee_type = 'user' AND grantee_id = ?
           AND (permission = ? OR permission = '*')
           AND (expires_at IS NULL OR expires_at > datetime('now'))`,
        resourceType, resourceId, userId, action,
      );
      if (userGrant) return true;
    }

    // 2. Public grant
    const publicGrant = this.db.get(
      `SELECT 1 FROM _nk_resource_permissions
       WHERE resource_type = ? AND resource_id = ?
         AND grantee_type = 'public'
         AND (permission = ? OR permission = '*')
         AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      resourceType, resourceId, action,
    );
    if (publicGrant) return true;

    // 3. Anonymous grant
    if (anonymous) {
      const anonGrant = this.db.get(
        `SELECT 1 FROM _nk_resource_permissions
         WHERE resource_type = ? AND resource_id = ?
           AND grantee_type = 'anonymous'
           AND (permission = ? OR permission = '*')
           AND (expires_at IS NULL OR expires_at > datetime('now'))`,
        resourceType, resourceId, action,
      );
      if (anonGrant) return true;
    }

    // 4. Role-based: check user's roles → role permissions
    if (userId) {
      const roleMatch = this.db.get(
        `SELECT 1 FROM _nk_user_roles ur
         JOIN _nk_roles r ON r.id = ur.role_id
         WHERE ur.user_id = ?
           AND (
             (ur.resource_type IS NULL OR ur.resource_type = '')
             OR (ur.resource_type = ? AND ur.resource_id = ?)
           )
           AND EXISTS (
             SELECT 1 FROM json_each(r.permissions) je
             WHERE je.value = ? OR je.value = ? || ':*' OR je.value = '*'
           )`,
        userId,
        resourceType, resourceId,
        permissionType, resourceType,
      );
      if (roleMatch) return true;
    }

    return false;
  }

  // ── Resource queries ──────────────────────────────────────────

  /**
   * Get all resource IDs of a given type that a user can access.
   */
  getAccessibleResourceIds(
    userId: string,
    resourceType: string,
    permission: string,
  ): string[] {
    const [, action] = permission.includes(':')
      ? permission.split(':')
      : [resourceType, permission];

    const rows = this.db.all(
      `SELECT DISTINCT resource_id FROM _nk_resource_permissions
       WHERE resource_type = ?
         AND (
           (grantee_type = 'user' AND grantee_id = ?)
           OR grantee_type = 'public'
         )
         AND (permission = ? OR permission = '*')
         AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      resourceType, userId, action,
    );

    return rows.map((r: any) => r.resource_id);
  }

  /**
   * Get all permissions for a resource.
   */
  getPermissionsForResource(
    resourceType: string,
    resourceId: string,
  ): ResourcePermission[] {
    return this.db.all(
      `SELECT * FROM _nk_resource_permissions
       WHERE resource_type = ? AND resource_id = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at`,
      resourceType, resourceId,
    );
  }

  // ── Mutations (all audited) ───────────────────────────────────

  /**
   * Initialize owner permissions when a resource is created.
   */
  initOwnerPermissions(
    resourceType: string,
    resourceId: string,
    userId: string,
  ): void {
    for (const perm of this.config.defaultOwnerGrants) {
      this.db.run(
        `INSERT OR IGNORE INTO _nk_resource_permissions
         (resource_type, resource_id, grantee_type, grantee_id, permission, granted_by)
         VALUES (?, ?, 'user', ?, ?, ?)`,
        resourceType, resourceId, userId, perm, userId,
      );
    }
    this.audit('init_owner', userId, {
      resourceType, resourceId,
      details: `Granted: ${this.config.defaultOwnerGrants.join(', ')}`,
    });
  }

  /**
   * Grant a permission on a resource.
   */
  grant(
    resourceType: string,
    resourceId: string,
    granteeType: string,
    granteeId: string | null,
    permission: string,
    grantedBy: string,
  ): void {
    this.db.run(
      `INSERT OR IGNORE INTO _nk_resource_permissions
       (resource_type, resource_id, grantee_type, grantee_id, permission, granted_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      resourceType, resourceId, granteeType, granteeId, permission, grantedBy,
    );
    this.audit('grant', grantedBy, {
      resourceType, resourceId, granteeType, granteeId, permission,
    });
  }

  /**
   * Revoke a permission on a resource.
   */
  revoke(
    resourceType: string,
    resourceId: string,
    granteeType: string,
    granteeId: string | null,
    permission: string,
    revokedBy: string,
  ): void {
    this.db.run(
      `DELETE FROM _nk_resource_permissions
       WHERE resource_type = ? AND resource_id = ?
         AND grantee_type = ? AND COALESCE(grantee_id, '') = COALESCE(?, '')
         AND permission = ?`,
      resourceType, resourceId, granteeType, granteeId, permission,
    );
    this.audit('revoke', revokedBy, {
      resourceType, resourceId, granteeType, granteeId, permission,
    });
  }

  /**
   * Make a resource publicly accessible (read).
   */
  makePublic(resourceType: string, resourceId: string, grantedBy: string): void {
    this.grant(resourceType, resourceId, 'public', null, 'read', grantedBy);
  }

  /**
   * Remove public access from a resource.
   */
  removePublic(resourceType: string, resourceId: string, removedBy: string): void {
    this.db.run(
      `DELETE FROM _nk_resource_permissions
       WHERE resource_type = ? AND resource_id = ? AND grantee_type = 'public'`,
      resourceType, resourceId,
    );
    this.audit('remove_public', removedBy, { resourceType, resourceId });
  }

  /**
   * Assign a role to a user (globally or scoped to a resource).
   */
  assignRole(
    userId: string,
    roleId: string,
    assignedBy: string,
    resourceType?: string,
    resourceId?: string,
  ): void {
    this.db.run(
      `INSERT OR IGNORE INTO _nk_user_roles (user_id, role_id, resource_type, resource_id)
       VALUES (?, ?, ?, ?)`,
      userId, roleId, resourceType ?? null, resourceId ?? null,
    );
    this.audit('assign_role', assignedBy, {
      granteeType: 'user', granteeId: userId, roleId,
      resourceType, resourceId,
    });
  }

  /**
   * Remove a role from a user.
   */
  removeRole(
    userId: string,
    roleId: string,
    removedBy: string,
    resourceType?: string,
    resourceId?: string,
  ): void {
    this.db.run(
      `DELETE FROM _nk_user_roles
       WHERE user_id = ? AND role_id = ?
         AND COALESCE(resource_type, '') = COALESCE(?, '')
         AND COALESCE(resource_id, '') = COALESCE(?, '')`,
      userId, roleId, resourceType ?? null, resourceId ?? null,
    );
    this.audit('remove_role', removedBy, {
      granteeType: 'user', granteeId: userId, roleId,
      resourceType, resourceId,
    });
  }
}

/**
 * Create a PermissionService instance from the LumenJS database.
 */
export function usePermissions(db: any, config?: Partial<ResolvedPermissionsConfig>): PermissionService {
  return new PermissionService(db, config);
}
