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

        const FILES_READ = 1 << 4;
        const FILES_WRITE = 1 << 5;

        const DATABASE_VIEW = 1 << 8;
        const DATABASE_MANAGE = 1 << 9;

        const BACKUP_VIEW = 1 << 13;
        const BACKUP_DOWNLOAD = 1 << 14;
        const BACKUP_CREATE = 1 << 15;
        const BACKUP_DELETE = 1 << 16;
        const BACKUP_RESTORE = 1 << 17;

        const USER_VIEW = 1 << 18;
        const USER_EDIT = 1 << 19;

        const ADMIN_MANAGEMENT = 1 << 20;
    }

    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
    #[repr(transparent)]
    pub struct ManagementPermissions: i64 {
        const SERVER_VIEW = 1 << 22;
        const SERVER_MANAGE = 1 << 31;
        const SERVER_SUSPEND = 1 << 36;

        const USER_VIEW = 1 << 23;
        const USER_MANAGE = 1 << 24;

        const API_KEYS_VIEW = 1 << 27;
        const API_KEYS_MANAGE = 1 << 28;

        const DATABASE_VIEW = 1 << 25;
        const DATABASE_MANAGE = 1 << 26;

        const NODES_VIEW = 1 << 29;
        const NODES_MANAGE = 1 << 30;

        const NETWORK_VIEW = 1 << 33;
        const NETWORK_MANAGE = 1 << 34;

        const BACKUP_STORAGE_SELECT = 1 << 35;
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum Role {
    Admin,
    ServerManager,
    Moderator,
    User,
}

impl Role {
    pub fn management_permissions(self) -> ManagementPermissions {
        match self {
            Self::Admin => ManagementPermissions::all(),
            Self::ServerManager => {
                ManagementPermissions::SERVER_VIEW
                    | ManagementPermissions::SERVER_MANAGE
                    | ManagementPermissions::SERVER_SUSPEND
                    | ManagementPermissions::DATABASE_VIEW
                    | ManagementPermissions::DATABASE_MANAGE
                    | ManagementPermissions::BACKUP_STORAGE_SELECT
            }
            Self::Moderator => {
                ManagementPermissions::SERVER_VIEW | ManagementPermissions::USER_VIEW
            }
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
                    | ServerPermissions::DATABASE_VIEW
                    | ServerPermissions::DATABASE_MANAGE
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
