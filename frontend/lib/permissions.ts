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
  ROUTES_VIEW: 2 ** 17,
  ROUTES_MANAGE: 2 ** 18,
  DATABASE_VIEW: 2 ** 19,
  DATABASE_MANAGE: 2 ** 20,
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
  LIMITS_BYPASS: 2 ** 46,
  FEATURES_MANAGE: 2 ** 47,
  DOMAINS_VIEW: 2 ** 48,
  DOMAINS_MANAGE: 2 ** 49,
  DATABASE_HOSTS_VIEW: 2 ** 50,
  DATABASE_HOSTS_MANAGE: 2 ** 51,
} as const;

const serverDependencyMap = [
  [ServerPermission.TERMINAL_WRITE, ServerPermission.TERMINAL_READ],
  [ServerPermission.BUILD_EDIT, ServerPermission.BUILD_VIEW],
  [ServerPermission.FILES_WRITE, ServerPermission.FILES_READ],
  [ServerPermission.BACKUP_DOWNLOAD, ServerPermission.BACKUP_VIEW],
  [ServerPermission.BACKUP_CREATE, ServerPermission.BACKUP_VIEW],
  [ServerPermission.BACKUP_DELETE, ServerPermission.BACKUP_VIEW],
  [ServerPermission.BACKUP_RESTORE, ServerPermission.BACKUP_VIEW],
  [ServerPermission.USER_EDIT, ServerPermission.USER_VIEW],
  [ServerPermission.ROUTES_VIEW, ServerPermission.NETWORK_VIEW],
  [ServerPermission.ROUTES_MANAGE, ServerPermission.ROUTES_VIEW],
  [ServerPermission.ROUTES_MANAGE, ServerPermission.NETWORK_VIEW],
  [ServerPermission.DATABASE_MANAGE, ServerPermission.DATABASE_VIEW],
] as const;

const managementDependencyMap = [
  [ManagementPermission.USER_MANAGE, ManagementPermission.USER_VIEW],
  [ManagementPermission.API_KEYS_MANAGE, ManagementPermission.API_KEYS_VIEW],
  [ManagementPermission.NODES_MANAGE, ManagementPermission.NODES_VIEW],
  [ManagementPermission.DOMAINS_MANAGE, ManagementPermission.DOMAINS_VIEW],
  [
    ManagementPermission.DATABASE_HOSTS_MANAGE,
    ManagementPermission.DATABASE_HOSTS_VIEW,
  ],
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

/** Whether `permissions` has the exact `bit` set (BigInt-safe). */
export function hasPermissionBit(permissions: number, bit: number) {
  return contains(permissions, bit);
}

/** Toggle a single permission bit on/off, preserving every other bit. */
export function setPermissionBit(permissions: number, bit: number, on: boolean) {
  const current = BigInt(permissions);
  const mask = BigInt(bit);
  return Number(on ? current | mask : current & ~mask);
}

/**
 * Expands a set of selected server permissions to include their implied
 * dependencies (e.g. `FILES_WRITE` implies `FILES_READ`, and any permission
 * implies `VIEW`). The backend applies the same rules when checking access.
 */
export function resolveServerPermissions(permissions: number) {
  return withServerDependencies(permissions);
}

/**
 * Expands a set of selected management permissions to include their implied
 * dependencies (e.g. `USER_MANAGE` implies `USER_VIEW`). The backend applies the
 * same rules when checking access.
 */
export function resolveManagementPermissions(permissions: number) {
  return withManagementDependencies(permissions);
}

/**
 * Server (project sub-user) permissions grouped for the permission picker.
 * These are the permissions a project member can be granted for the project's
 * servers.
 */
export const SERVER_PERMISSION_GROUPS: {
  group: string;
  permissions: { bit: number; label: string }[];
}[] = [
  {
    group: "General",
    permissions: [
      { bit: ServerPermission.VIEW, label: "View server" },
      { bit: ServerPermission.POWER, label: "Control power (start/stop/restart)" },
    ],
  },
  {
    group: "Console",
    permissions: [
      { bit: ServerPermission.TERMINAL_READ, label: "Read console output" },
      { bit: ServerPermission.TERMINAL_WRITE, label: "Send console commands" },
    ],
  },
  {
    group: "Startup",
    permissions: [
      { bit: ServerPermission.BUILD_VIEW, label: "View startup settings" },
      { bit: ServerPermission.BUILD_EDIT, label: "Edit startup settings" },
      {
        bit: ServerPermission.ADMIN_MANAGEMENT,
        label: "View secret startup variables",
      },
    ],
  },
  {
    group: "Files",
    permissions: [
      { bit: ServerPermission.FILES_READ, label: "Read files" },
      { bit: ServerPermission.FILES_WRITE, label: "Write files" },
    ],
  },
  {
    group: "Backups",
    permissions: [
      { bit: ServerPermission.BACKUP_VIEW, label: "View backups" },
      { bit: ServerPermission.BACKUP_DOWNLOAD, label: "Download backups" },
      { bit: ServerPermission.BACKUP_CREATE, label: "Create backups" },
      { bit: ServerPermission.BACKUP_DELETE, label: "Delete backups" },
      { bit: ServerPermission.BACKUP_RESTORE, label: "Restore backups" },
    ],
  },
  {
    group: "Members",
    permissions: [
      { bit: ServerPermission.USER_VIEW, label: "View members" },
      { bit: ServerPermission.USER_EDIT, label: "Manage members" },
    ],
  },
  {
    group: "Network",
    permissions: [{ bit: ServerPermission.NETWORK_VIEW, label: "View network & ports" }],
  },
  {
    group: "Databases",
    permissions: [
      { bit: ServerPermission.DATABASE_VIEW, label: "View databases & credentials" },
      { bit: ServerPermission.DATABASE_MANAGE, label: "Create & delete databases" },
    ],
  },
];

/**
 * Instance-wide permissions grouped for the permission picker. These are only
 * grantable to instance-wide API keys and to users through their role.
 */
export const MANAGEMENT_PERMISSION_GROUPS: {
  group: string;
  permissions: { bit: number; label: string }[];
}[] = [
  {
    group: "Servers",
    permissions: [
      { bit: ManagementPermission.SERVER_MANAGE, label: "Create & manage servers" },
      { bit: ManagementPermission.SERVER_SUSPEND, label: "Suspend servers" },
      { bit: ManagementPermission.SERVER_DELETE, label: "Delete servers" },
    ],
  },
  {
    group: "Users",
    permissions: [
      { bit: ManagementPermission.USER_VIEW, label: "View all users" },
      { bit: ManagementPermission.USER_MANAGE, label: "Manage users" },
    ],
  },
  {
    group: "API keys",
    permissions: [
      { bit: ManagementPermission.API_KEYS_VIEW, label: "View all API keys" },
      { bit: ManagementPermission.API_KEYS_MANAGE, label: "Manage API keys" },
    ],
  },
  {
    group: "Nodes",
    permissions: [
      { bit: ManagementPermission.NODES_VIEW, label: "View nodes" },
      { bit: ManagementPermission.NODES_MANAGE, label: "Manage nodes" },
    ],
  },
  {
    group: "Database hosts",
    permissions: [
      {
        bit: ManagementPermission.DATABASE_HOSTS_VIEW,
        label: "View database hosts",
      },
      {
        bit: ManagementPermission.DATABASE_HOSTS_MANAGE,
        label: "Manage database hosts & instances",
      },
    ],
  },
  {
    group: "Storage & network",
    permissions: [
      {
        bit: ManagementPermission.BACKUP_STORAGE_SELECT,
        label: "Choose backup storage",
      },
      { bit: ManagementPermission.NETWORK_CREATE, label: "Create networks" },
      { bit: ManagementPermission.NETWORK_DELETE, label: "Delete networks" },
    ],
  },
  {
    group: "Limits",
    permissions: [
      { bit: ManagementPermission.LIMITS_BYPASS, label: "Bypass limits" },
    ],
  },
];

/** Human-readable labels for every server permission granted by `permissions`. */
export function serverPermissionLabels(permissions: number): string[] {
  const resolved = resolveServerPermissions(permissions);
  return SERVER_PERMISSION_GROUPS.flatMap((group) =>
    group.permissions
      .filter((permission) => hasPermissionBit(resolved, permission.bit))
      .map((permission) => permission.label),
  );
}

/** Keeps only the bits of `permissions` that are also set in `mask`. */
export function maskPermissions(permissions: number, mask: number) {
  return Number(BigInt(permissions) & BigInt(mask));
}

/** Human-readable labels for every management permission granted. */
export function managementPermissionLabels(permissions: number): string[] {
  const resolved = resolveManagementPermissions(permissions);
  return MANAGEMENT_PERMISSION_GROUPS.flatMap((group) =>
    group.permissions
      .filter((permission) => hasPermissionBit(resolved, permission.bit))
      .map((permission) => permission.label),
  );
}

/**
 * Human-readable labels for everything `permissions` grants, across both
 * scopes. Used to summarise an API key.
 *
 * Each scope only sees its own bits — otherwise a management-only bitfield would
 * read as "non-empty" to the server scope and pick up an implied `VIEW`.
 */
export function permissionLabels(permissions: number): string[] {
  const server = maskPermissions(permissions, allServerPermissions);
  const management = maskPermissions(permissions, allManagementPermissions);

  return [
    ...(server === 0 ? [] : serverPermissionLabels(server)),
    ...managementPermissionLabels(management),
  ];
}
