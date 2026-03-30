/**
 * Auto-create permission tables in the LumenJS SQLite database.
 * Follows the same pattern as ensureUsersTable() in auth/native-auth.ts.
 */
export async function ensurePermissionTables(db: any): Promise<void> {
  if (db.isPg) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _nk_resource_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      grantee_type TEXT NOT NULL CHECK (grantee_type IN ('user', 'role', 'public', 'anonymous')),
      grantee_id TEXT NOT NULL DEFAULT '',
      permission TEXT NOT NULL,
      granted_by TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(resource_type, resource_id, grantee_type, grantee_id, permission)
    );

    CREATE INDEX IF NOT EXISTS idx_nk_rp_resource
      ON _nk_resource_permissions(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_nk_rp_grantee
      ON _nk_resource_permissions(grantee_type, grantee_id);

    CREATE TABLE IF NOT EXISTS _nk_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      permissions TEXT NOT NULL DEFAULT '[]',
      hierarchy INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _nk_user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      resource_type TEXT NOT NULL DEFAULT '',
      resource_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, role_id, resource_type, resource_id)
    );

    CREATE INDEX IF NOT EXISTS idx_nk_ur_user
      ON _nk_user_roles(user_id);

    CREATE TABLE IF NOT EXISTS _nk_permission_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      grantee_type TEXT,
      grantee_id TEXT,
      permission TEXT,
      role_id TEXT,
      actor_id TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_nk_pal_resource
      ON _nk_permission_audit_log(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_nk_pal_actor
      ON _nk_permission_audit_log(actor_id);
    CREATE INDEX IF NOT EXISTS idx_nk_pal_created
      ON _nk_permission_audit_log(created_at);
  `);
}
