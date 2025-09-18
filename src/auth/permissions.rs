use crate::db::server::ServerId;
use bitflags::bitflags;
use serde::{Deserialize, Serialize};

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub enum AccessPermission {
    Server(ServerId, ServerPermissions),
    Management(ManagementPermissions),
}

bitflags! {
    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default)]
    #[repr(transparent)]
    pub struct ServerPermissions: i64 {
        const VIEW = 1 << 0;
        const POWER = 1 << 1;

        const TERMINAL_READ = 1 << 2;
        const TERMINAL_WRITE = 1 << 3;

        const BUILD_VIEW = 1 << 4;
        const BUILD_EDIT = 1 << 5;

        const FILES_READ = 1 << 6;
        const FILES_WRITE = 1 << 7;

        const BACKUP_VIEW = 1 << 8;
        const BACKUP_DOWNLOAD = 1 << 9;
        const BACKUP_CREATE = 1 << 10;
        const BACKUP_DELETE = 1 << 11;
        const BACKUP_RESTORE = 1 << 12;

        const USER_VIEW = 1 << 13;
        const USER_EDIT = 1 << 14;

        const ADMIN_MANAGEMENT = 1 << 15;
    }

    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
    #[repr(transparent)]
    pub struct ManagementPermissions: i64 {
        const SERVER_MANAGE = 1 << 32;
        const SERVER_SUSPEND = 1 << 33;
        const SERVER_DELETE = 1 << 34;

        const USER_VIEW = 1 << 35;
        const USER_MANAGE = 1 << 36;

        const API_KEYS_VIEW = 1 << 37;
        const API_KEYS_MANAGE = 1 << 38;

        const NODES_VIEW = 1 << 39;
        const NODES_MANAGE = 1 << 40;

        const BACKUP_STORAGE_SELECT = 1 << 41;

        const NETWORK_CREATE = 1 << 42;
        const NETWORK_DELETE = 1 << 43;

        const DATABASE_CREATE = 1 << 44;
        const DATABASE_DELETE = 1 << 45;

        const LIMITS_BYPASS = 1 << 46;
    }
}

impl AccessPermission {
    pub fn with_dependencies(self) -> Self {
        match self {
            AccessPermission::Server(server_id, perms) => {
                AccessPermission::Server(server_id, perms.with_dependencies())
            }
            AccessPermission::Management(perms) => {
                AccessPermission::Management(perms.with_dependencies())
            }
        }
    }
}

impl ServerPermissions {
    pub fn with_dependencies(mut self) -> Self {
        if !self.is_empty() {
            self |= ServerPermissions::VIEW;
        }
        self.with_dependency(Self::TERMINAL_WRITE, Self::TERMINAL_READ);
        self.with_dependency(Self::BUILD_EDIT, Self::BUILD_VIEW);
        self.with_dependency(Self::FILES_WRITE, Self::FILES_READ);

        self.with_dependency(Self::BACKUP_DOWNLOAD, Self::BACKUP_VIEW);
        self.with_dependency(Self::BACKUP_CREATE, Self::BACKUP_VIEW);
        self.with_dependency(Self::BACKUP_DELETE, Self::BACKUP_VIEW);
        self.with_dependency(Self::BACKUP_RESTORE, Self::BACKUP_VIEW);

        self.with_dependency(Self::USER_EDIT, Self::USER_VIEW);
        self
    }

    fn with_dependency(&mut self, base: Self, dependencies: Self) {
        if self.contains(base) {
            *self |= dependencies;
        }
    }
}

impl ManagementPermissions {
    pub fn with_dependencies(mut self) -> Self {
        self.with_dependency(Self::USER_MANAGE, Self::USER_VIEW);
        self.with_dependency(Self::API_KEYS_MANAGE, Self::API_KEYS_VIEW);
        self.with_dependency(Self::NODES_MANAGE, Self::NODES_VIEW);
        self
    }

    fn with_dependency(&mut self, base: Self, dependencies: Self) {
        if self.contains(base) {
            *self |= dependencies;
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Role {
    Admin = 3,
    ServerManager = 2,
    Moderator = 1,
    User = 0,
}

impl TryFrom<u8> for Role {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::User),
            1 => Ok(Self::Moderator),
            2 => Ok(Self::ServerManager),
            3 => Ok(Self::Admin),
            _ => Err(()),
        }
    }
}

impl Role {
    pub fn management_permissions(self) -> ManagementPermissions {
        match self {
            Self::Admin => ManagementPermissions::all(),
            Self::ServerManager => {
                ManagementPermissions::SERVER_MANAGE
                    | ManagementPermissions::SERVER_SUSPEND
                    | ManagementPermissions::BACKUP_STORAGE_SELECT
            }
            Self::Moderator => ManagementPermissions::USER_VIEW,
            Self::User => ManagementPermissions::empty(),
        }
    }

    pub fn server_permissions(self) -> ServerPermissions {
        match self {
            Self::Admin => ServerPermissions::all(),
            Self::ServerManager => {
                ServerPermissions::VIEW
                    | ServerPermissions::POWER
                    | ServerPermissions::TERMINAL_READ
                    | ServerPermissions::TERMINAL_WRITE
                    | ServerPermissions::FILES_READ
                    | ServerPermissions::FILES_WRITE
                    | ServerPermissions::BACKUP_VIEW
                    | ServerPermissions::BACKUP_CREATE
                    | ServerPermissions::BACKUP_RESTORE
            }
            Self::Moderator => {
                ServerPermissions::VIEW
                    | ServerPermissions::POWER
                    | ServerPermissions::TERMINAL_READ
            }
            Self::User => ServerPermissions::empty(),
        }
    }
}
