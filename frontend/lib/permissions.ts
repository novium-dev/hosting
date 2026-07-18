export const ServerPermission = {
  VIEW: 2 ** 0,
  POWER: 2 ** 1,
  TERMINAL_READ: 2 ** 2,
  TERMINAL_WRITE: 2 ** 3,
  BUILD_VIEW: 2 ** 4,
  BUILD_EDIT: 2 ** 5,
  FILES_READ: 2 ** 6,
  FILES_WRITE: 2 ** 7,
  BACKUP_VIEW: 2 ** 8,
  BACKUP_DOWNLOAD: 2 ** 9,
  BACKUP_CREATE: 2 ** 10,
  BACKUP_DELETE: 2 ** 11,
  BACKUP_RESTORE: 2 ** 12,
  USER_VIEW: 2 ** 13,
  USER_EDIT: 2 ** 14,
  NETWORK_VIEW: 2 ** 15,
  ADMIN_MANAGEMENT: 2 ** 16,
} as const;

export const ManagementPermission = {
  SERVER_MANAGE: 2 ** 32,
  SERVER_SUSPEND: 2 ** 33,
  SERVER_DELETE: 2 ** 34,
  USER_VIEW: 2 ** 35,
  USER_MANAGE: 2 ** 36,
  API_KEYS_VIEW: 2 ** 37,
  API_KEYS_MANAGE: 2 ** 38,
  NODES_VIEW: 2 ** 39,
  NODES_MANAGE: 2 ** 40,
  BACKUP_STORAGE_SELECT: 2 ** 41,
  NETWORK_CREATE: 2 ** 42,
  NETWORK_DELETE: 2 ** 43,
  DATABASE_CREATE: 2 ** 44,
  DATABASE_DELETE: 2 ** 45,
  LIMITS_BYPASS: 2 ** 46,
} as const;

export type ProjectRole = "owner" | "admin" | "member";

const serverDependencyMap = [
  [ServerPermission.TERMINAL_WRITE, ServerPermission.TERMINAL_READ],
  [ServerPermission.BUILD_EDIT, ServerPermission.BUILD_VIEW],
  [ServerPermission.FILES_WRITE, ServerPermission.FILES_READ],
  [ServerPermission.BACKUP_DOWNLOAD, ServerPermission.BACKUP_VIEW],
  [ServerPermission.BACKUP_CREATE, ServerPermission.BACKUP_VIEW],
  [ServerPermission.BACKUP_DELETE, ServerPermission.BACKUP_VIEW],
  [ServerPermission.BACKUP_RESTORE, ServerPermission.BACKUP_VIEW],
  [ServerPermission.USER_EDIT, ServerPermission.USER_VIEW],
] as const;

const managementDependencyMap = [
  [ManagementPermission.USER_MANAGE, ManagementPermission.USER_VIEW],
  [ManagementPermission.API_KEYS_MANAGE, ManagementPermission.API_KEYS_VIEW],
  [ManagementPermission.NODES_MANAGE, ManagementPermission.NODES_VIEW],
] as const;

const serverPermissionValues = Object.values(ServerPermission);
const managementPermissionValues = Object.values(ManagementPermission);

export const allServerPermissions = serverPermissionValues.reduce(
  (total, permission) => total + permission,
  0,
);

export const allManagementPermissions = managementPermissionValues.reduce(
  (total, permission) => total + permission,
  0,
);

function contains(permissions: number, permission: number) {
  return (BigInt(permissions) & BigInt(permission)) === BigInt(permission);
}

function withServerDependencies(permission: number) {
  let result = permission;
  if (result !== 0) result += contains(result, ServerPermission.VIEW) ? 0 : ServerPermission.VIEW;

  for (const [base, dependency] of serverDependencyMap) {
    if (contains(result, base) && !contains(result, dependency)) {
      result += dependency;
    }
  }

  return result;
}

function withManagementDependencies(permission: number) {
  let result = permission;

  for (const [base, dependency] of managementDependencyMap) {
    if (contains(result, base) && !contains(result, dependency)) {
      result += dependency;
    }
  }

  return result;
}

export function hasServerPermission(permissions: number, permission: number) {
  return contains(permissions, withServerDependencies(permission));
}

export function hasManagementPermission(
  permissions: number,
  permission: number,
) {
  return contains(permissions, withManagementDependencies(permission));
}

export function hasAnyManagementPermission(permissions: number) {
  return managementPermissionValues.some((permission) =>
    hasManagementPermission(permissions, permission),
  );
}

export function mergePermissions(...permissions: number[]) {
  return Number(
    permissions.reduce(
      (total, permission) => total | BigInt(permission),
      BigInt(0),
    ),
  );
}

export const projectRolePermissions: Record<ProjectRole, number> = {
  member: ServerPermission.VIEW,
  admin: allServerPermissions,
  owner:
    mergePermissions(
      allServerPermissions,
      ManagementPermission.SERVER_MANAGE,
      ManagementPermission.SERVER_SUSPEND,
      ManagementPermission.SERVER_DELETE,
      ManagementPermission.BACKUP_STORAGE_SELECT,
    ),
};

export function projectRoleFromPermissions(permissions: number): ProjectRole {
  if (
    hasServerPermission(permissions, ServerPermission.USER_EDIT) ||
    hasManagementPermission(permissions, ManagementPermission.SERVER_MANAGE)
  ) {
    return hasManagementPermission(permissions, ManagementPermission.SERVER_DELETE)
      ? "owner"
      : "admin";
  }

  return "member";
}
