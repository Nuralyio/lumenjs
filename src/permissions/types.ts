export interface ResourcePermission {
  id: number;
  resource_type: string;
  resource_id: string;
  grantee_type: 'user' | 'role' | 'public' | 'anonymous';
  grantee_id: string | null;
  permission: string;
  granted_by: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  hierarchy: number;
  created_at: string;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
}

export interface PermissionsConfig {
  enabled?: boolean;
  defaultOwnerGrants?: string[];
}

export interface ResolvedPermissionsConfig {
  enabled: boolean;
  defaultOwnerGrants: string[];
}
