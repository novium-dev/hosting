use crate::db::server::ServerId;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::error_server_not_found::FromServerNotFound;
use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub trait HasPermission {
    type Extra;

    fn has(
        self,
        extra: Self::Extra,
        permissions: i64,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> bool
    where
        Self: Sized;
}

pub trait Permission<E>: HasPermission {
    fn require(
        self,
        extra: Self::Extra,
        permissions: i64,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> Result<(), E>
    where
        Self: Sized;
}

bitflags! {
    /// Permission set on a per-server basis
    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default)]
    #[repr(transparent)]
    pub struct ServerPermissions: i64 {
        /// Allows the user to see the server.
        /// Any action not covered by other permissions will be granted with this permission.
        ///
        /// JWT Claim: view
        const VIEW = 1 << 0;
        /// Allows the user to start, stop, restart and kill the server.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: power
        const POWER = 1 << 1;

        /// Allows the user to see the content on the server terminal.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: terminal.read
        const TERMINAL_READ = 1 << 2;
        /// Allows the user to write contents into the console, assuming the server software allows it.
        ///
        /// Depends on [`ServerPermissions::TERMINAL_READ`]
        /// JWT Claim: terminal.write
        const TERMINAL_WRITE = 1 << 3;

        /// Allows the user to view the server settings that are set for the selected template.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: build.view
        const BUILD_VIEW = 1 << 4;
        /// Allows the user to modify the server settings.
        /// It does not allow the change of the selected template.
        ///
        /// Depends on [`ServerPermissions::BUILD_VIEW`]
        /// JWT Claim: build.edit
        const BUILD_EDIT = 1 << 5;

        /// Allows the user to access files.
        /// It does not allow modification of the files in any way.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: files.read
        const FILES_READ = 1 << 6;
        /// Allows the user to modify files.
        ///
        /// Depends on [`ServerPermissions::FILES_READ`]
        /// JWT Claim: files.write
        const FILES_WRITE = 1 << 7;

        /// Allows the user to view existing backups.
        /// It does not allow to view the contents of the backup.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: backup.view
        const BACKUP_VIEW = 1 << 8;
        /// Allows the user to download existing backups or access them via sftp.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        /// JWT Claim: backup.download
        const BACKUP_DOWNLOAD = 1 << 9;
        /// Allows the user to create a backup from the current server files.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        /// JWT Claim: backup.create
        const BACKUP_CREATE = 1 << 10;
        /// Allows the user to delete a backup.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        /// JWT Claim: backup.delete
        const BACKUP_DELETE = 1 << 11;
        /// Allows the user to restore an existing backup.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        /// JWT Claim: backup.restore
        const BACKUP_RESTORE = 1 << 12;

        /// Allows the user to view the permissions of other users.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: user.view
        const USER_VIEW = 1 << 13;
        /// Allows the user to modify the permissions of other users.
        /// It cannot take away an permissions from the server owner.
        ///
        /// Depends on [`ServerPermissions::USER_EDIT`]
        /// JWT Claim: user.edit
        const USER_EDIT = 1 << 14;

        /// Allows
        /// - the rename of the server
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: admin.management
        const ADMIN_MANAGEMENT = 1 << 15;
    }

    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
    #[repr(transparent)]
    pub struct ManagementPermissions: i64 {
        /// Allows the user to change the
        /// - selected template
        /// - resource quota (cpu, memory, swap and disk)
        /// - internet access
        /// - limits (backup)
        /// - network ports
        /// of a server.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: server.manage
        const SERVER_MANAGE = 1 << 32;
        /// Allows the user to suspend a server.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: server.suspend
        const SERVER_SUSPEND = 1 << 33;
        /// Allows the user to delete a server.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        /// JWT Claim: server.delete
        const SERVER_DELETE = 1 << 34;

        /// Allows the user to view all the users on this instance.
        ///
        /// JWT Claim: user.view
        const USER_VIEW = 1 << 35;
        /// Allows the user to modify or delete users on this instance.
        ///
        /// Depends on [`ManagementPermissions::USER_VIEW`]
        /// JWT Claim: user.manage
        const USER_MANAGE = 1 << 36;

        /// Allows the user to see api keys on this instance.
        /// The api keys are only visible on creation and therefore not accessible to anyone with this permission.
        ///
        /// JWT Claim: api_keys.view (or api-keys.view)
        const API_KEYS_VIEW = 1 << 37;
        /// Allows the user to create, edit and delete api keys on this instance.
        ///
        /// Depends on [`ManagementPermissions::API_KEYS_VIEW`]
        /// JWT Claim: api_keys.manage (or api-keys.manage)
        const API_KEYS_MANAGE = 1 << 38;

        /// Allows the user to view all registered nodes on this instance.
        ///
        /// JWT Claim: nodes.view
        const NODES_VIEW = 1 << 39;
        /// Allows the user to modify and unregister all existing nodes and to register new nodes.
        ///
        /// Depends on [`ManagementPermissions::NODES_VIEW`]
        /// JWT Claim: nodes.manage
        const NODES_MANAGE = 1 << 40;

        /// Allows the user to create server backups in a backup storage of their choice.
        ///
        /// Depends on [`ServerPermissions::BACKUP_CREATE`]
        /// JWT Claim: backup.storage.select
        const BACKUP_STORAGE_SELECT = 1 << 41;

        /// Allows the user to create networks.
        ///
        /// JWT Claim: network.create
        const NETWORK_CREATE = 1 << 42;
        /// Allows the user to delete networks.
        ///
        /// JWT Claim: network.delete
        const NETWORK_DELETE = 1 << 43;

        /// Allows the user to create databases of any kind.
        ///
        /// JWT Claim: database.create
        const DATABASE_CREATE = 1 << 44;
        /// Allows the user to delete databases of any kind.
        ///
        /// JWT Claim: database.delete
        const DATABASE_DELETE = 1 << 45;

        /// Allows the user to bypass global and server-specific limits.
        ///
        /// JWT Claim: limits.bypass
        const LIMITS_BYPASS = 1 << 46;
    }
}

impl HasPermission for ServerPermissions {
    type Extra = ServerId;

    fn has(
        self,
        extra: Self::Extra,
        permissions: i64,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> bool
    where
        Self: Sized,
    {
        (servers.get(&extra).copied().unwrap_or_default() | Self::from_bits_retain(permissions))
            .contains(self.with_dependencies())
    }
}
impl<E: FromAuthPermissionDenied + FromServerNotFound> Permission<E> for ServerPermissions {
    fn require(
        self,
        extra: Self::Extra,
        permissions: i64,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> Result<(), E>
    where
        Self: Sized,
    {
        if self.has(extra, permissions, servers) {
            Ok(())
        } else if Self::VIEW.has(extra, permissions, servers) {
            Err(<E as FromAuthPermissionDenied>::from())
        } else {
            Err(<E as FromServerNotFound>::from())
        }
    }
}

impl HasPermission for ManagementPermissions {
    type Extra = ();

    fn has(
        self,
        _extra: Self::Extra,
        permissions: i64,
        _servers: &HashMap<ServerId, ServerPermissions>,
    ) -> bool
    where
        Self: Sized,
    {
        Self::from_bits_retain(permissions).contains(self.with_dependencies())
    }
}
impl<E: FromAuthPermissionDenied> Permission<E> for ManagementPermissions {
    fn require(
        self,
        extra: Self::Extra,
        permissions: i64,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> Result<(), E>
    where
        Self: Sized,
    {
        if self.has(extra, permissions, servers) {
            Ok(())
        } else {
            Err(E::from())
        }
    }
}

// TODO: Permission handling of databases and networks

impl ServerPermissions {
    fn with_dependencies(mut self) -> Self {
        if !self.is_empty() {
            self |= Self::VIEW;
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
    fn with_dependencies(mut self) -> Self {
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

    pub fn from_claim_action(action: &str) -> Option<Self> {
        match action.trim().to_ascii_lowercase().as_str() {
            "*" => Some(Self::all()),
            "server.manage" => Some(Self::SERVER_MANAGE),
            "server.suspend" => Some(Self::SERVER_SUSPEND),
            "server.delete" => Some(Self::SERVER_DELETE),
            "user.view" => Some(Self::USER_VIEW),
            "user.manage" => Some(Self::USER_MANAGE),
            "api_keys.view" | "api-keys.view" => Some(Self::API_KEYS_VIEW),
            "api_keys.manage" | "api-keys.manage" => Some(Self::API_KEYS_MANAGE),
            "nodes.view" => Some(Self::NODES_VIEW),
            "nodes.manage" => Some(Self::NODES_MANAGE),
            "backup.storage.select" => Some(Self::BACKUP_STORAGE_SELECT),
            "network.create" => Some(Self::NETWORK_CREATE),
            "network.delete" => Some(Self::NETWORK_DELETE),
            "database.create" => Some(Self::DATABASE_CREATE),
            "database.delete" => Some(Self::DATABASE_DELETE),
            "limits.bypass" => Some(Self::LIMITS_BYPASS),
            _ => None,
        }
    }
}

impl ServerPermissions {
    pub fn from_claim_action(action: &str) -> Option<Self> {
        match action.trim().to_ascii_lowercase().as_str() {
            "*" => Some(Self::all()),
            "view" => Some(Self::VIEW),
            "power" => Some(Self::POWER),
            "terminal.read" => Some(Self::TERMINAL_READ),
            "terminal.write" => Some(Self::TERMINAL_WRITE),
            "build.view" => Some(Self::BUILD_VIEW),
            "build.edit" => Some(Self::BUILD_EDIT),
            "files.read" => Some(Self::FILES_READ),
            "files.write" => Some(Self::FILES_WRITE),
            "backup.view" => Some(Self::BACKUP_VIEW),
            "backup.download" => Some(Self::BACKUP_DOWNLOAD),
            "backup.create" => Some(Self::BACKUP_CREATE),
            "backup.delete" => Some(Self::BACKUP_DELETE),
            "backup.restore" => Some(Self::BACKUP_RESTORE),
            "user.view" => Some(Self::USER_VIEW),
            "user.edit" => Some(Self::USER_EDIT),
            "admin.management" => Some(Self::ADMIN_MANAGEMENT),
            _ => None,
        }
    }
}
