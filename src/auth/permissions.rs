use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::error_project_not_found::FromProjectNotFound;
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
        projects: &HashMap<ProjectId, ServerPermissions>,
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
        projects: &HashMap<ProjectId, ServerPermissions>,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> Result<(), E>
    where
        Self: Sized;
}

bitflags! {
    /// Permission set on a per-project basis.
    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default)]
    #[repr(transparent)]
    pub struct ProjectPermissions: i64 {
        /// Allows the user to see the project.
        const VIEW = ServerPermissions::VIEW.bits();
        /// Allows the user to view project members.
        const USER_VIEW = ServerPermissions::USER_VIEW.bits();
        /// Allows the user to modify project members.
        const USER_EDIT = ServerPermissions::USER_EDIT.bits();
        /// Allows the user to manage project metadata and servers.
        const ADMIN_MANAGEMENT = ServerPermissions::ADMIN_MANAGEMENT.bits();
    }

    /// Permission set on a per-server basis
    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default)]
    #[repr(transparent)]
    pub struct ServerPermissions: i64 {
        /// Allows the user to see the server.
        /// Any action not covered by other permissions will be granted with this permission.
        ///
        const VIEW = 1 << 0;
        /// Allows the user to start, stop, restart and kill the server.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const POWER = 1 << 1;

        /// Allows the user to see the content on the server terminal.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const TERMINAL_READ = 1 << 2;
        /// Allows the user to write contents into the console, assuming the server software allows it.
        ///
        /// Depends on [`ServerPermissions::TERMINAL_READ`]
        const TERMINAL_WRITE = 1 << 3;

        /// Allows the user to view the server settings that are set for the selected template.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const BUILD_VIEW = 1 << 4;
        /// Allows the user to modify the server settings.
        /// It does not allow the change of the selected template.
        ///
        /// Depends on [`ServerPermissions::BUILD_VIEW`]
        const BUILD_EDIT = 1 << 5;

        /// Allows the user to access files.
        /// It does not allow modification of the files in any way.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const FILES_READ = 1 << 6;
        /// Allows the user to modify files.
        ///
        /// Depends on [`ServerPermissions::FILES_READ`]
        const FILES_WRITE = 1 << 7;

        /// Allows the user to view existing backups.
        /// It does not allow to view the contents of the backup.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const BACKUP_VIEW = 1 << 8;
        /// Allows the user to download existing backups or access them via sftp.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        const BACKUP_DOWNLOAD = 1 << 9;
        /// Allows the user to create a backup from the current server files.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        const BACKUP_CREATE = 1 << 10;
        /// Allows the user to delete a backup.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        const BACKUP_DELETE = 1 << 11;
        /// Allows the user to restore an existing backup.
        ///
        /// Depends on [`ServerPermissions::BACKUP_VIEW`]
        const BACKUP_RESTORE = 1 << 12;

        /// Allows the user to view the permissions of other users.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const USER_VIEW = 1 << 13;
        /// Allows the user to modify the permissions of other users.
        /// It cannot take away permissions from the project owner.
        ///
        /// Depends on [`ServerPermissions::USER_EDIT`]
        const USER_EDIT = 1 << 14;


        /// Allows the user to view the server's network configuration, including assigned ports and networks.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const NETWORK_VIEW = 1 << 15;

        /// Allows
        /// - the rename of the server
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const ADMIN_MANAGEMENT = 1 << 16;
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
        const SERVER_MANAGE = 1 << 32;
        /// Allows the user to suspend a server.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const SERVER_SUSPEND = 1 << 33;
        /// Allows the user to delete a server.
        ///
        /// Depends on [`ServerPermissions::VIEW`]
        const SERVER_DELETE = 1 << 34;

        /// Allows the user to view all the users on this instance.
        ///
        const USER_VIEW = 1 << 35;
        /// Allows the user to modify or delete users on this instance.
        ///
        /// Depends on [`ManagementPermissions::USER_VIEW`]
        const USER_MANAGE = 1 << 36;

        /// Allows the user to see api keys on this instance.
        /// The api keys are only visible on creation and therefore not accessible to anyone with this permission.
        ///
        const API_KEYS_VIEW = 1 << 37;
        /// Allows the user to create, edit and delete api keys on this instance.
        ///
        /// Depends on [`ManagementPermissions::API_KEYS_VIEW`]
        const API_KEYS_MANAGE = 1 << 38;

        /// Allows the user to view all registered nodes on this instance.
        ///
        const NODES_VIEW = 1 << 39;
        /// Allows the user to modify and unregister all existing nodes and to register new nodes.
        ///
        /// Depends on [`ManagementPermissions::NODES_VIEW`]
        const NODES_MANAGE = 1 << 40;

        /// Allows the user to create server backups in a backup storage of their choice.
        ///
        /// Depends on [`ServerPermissions::BACKUP_CREATE`]
        const BACKUP_STORAGE_SELECT = 1 << 41;

        /// Allows the user to create networks.
        ///
        const NETWORK_CREATE = 1 << 42;
        /// Allows the user to delete networks.
        ///
        const NETWORK_DELETE = 1 << 43;

        /// Allows the user to create databases of any kind.
        ///
        const DATABASE_CREATE = 1 << 44;
        /// Allows the user to delete databases of any kind.
        ///
        const DATABASE_DELETE = 1 << 45;

        /// Allows the user to bypass global and server-specific limits.
        ///
        const LIMITS_BYPASS = 1 << 46;
    }
}

impl HasPermission for ServerPermissions {
    type Extra = ServerId;

    fn has(
        self,
        extra: Self::Extra,
        permissions: i64,
        _projects: &HashMap<ProjectId, ServerPermissions>,
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
        projects: &HashMap<ProjectId, ServerPermissions>,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> Result<(), E>
    where
        Self: Sized,
    {
        if self.has(extra, permissions, projects, servers) {
            Ok(())
        } else if Self::VIEW.has(extra, permissions, projects, servers) {
            Err(<E as FromAuthPermissionDenied>::from())
        } else {
            Err(<E as FromServerNotFound>::from())
        }
    }
}

impl HasPermission for ProjectPermissions {
    type Extra = ProjectId;

    fn has(
        self,
        extra: Self::Extra,
        permissions: i64,
        projects: &HashMap<ProjectId, ServerPermissions>,
        _servers: &HashMap<ServerId, ServerPermissions>,
    ) -> bool
    where
        Self: Sized,
    {
        let permissions = projects.get(&extra).copied().unwrap_or_default()
            | ServerPermissions::from_bits_retain(permissions);
        permissions.contains(ServerPermissions::from_bits_retain(
            self.with_dependencies().bits(),
        ))
    }
}
impl<E: FromAuthPermissionDenied + FromProjectNotFound> Permission<E> for ProjectPermissions {
    fn require(
        self,
        extra: Self::Extra,
        permissions: i64,
        projects: &HashMap<ProjectId, ServerPermissions>,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> Result<(), E>
    where
        Self: Sized,
    {
        if self.has(extra, permissions, projects, servers) {
            Ok(())
        } else if Self::VIEW.has(extra, permissions, projects, servers) {
            Err(<E as FromAuthPermissionDenied>::from())
        } else {
            Err(<E as FromProjectNotFound>::from())
        }
    }
}

impl HasPermission for ManagementPermissions {
    type Extra = ();

    fn has(
        self,
        _extra: Self::Extra,
        permissions: i64,
        _projects: &HashMap<ProjectId, ServerPermissions>,
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
        projects: &HashMap<ProjectId, ServerPermissions>,
        servers: &HashMap<ServerId, ServerPermissions>,
    ) -> Result<(), E>
    where
        Self: Sized,
    {
        if self.has(extra, permissions, projects, servers) {
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

impl ProjectPermissions {
    fn with_dependencies(mut self) -> Self {
        if !self.is_empty() {
            self |= Self::VIEW;
        }
        self.with_dependency(Self::USER_EDIT, Self::USER_VIEW);
        self
    }

    fn with_dependency(&mut self, permission: Self, dependency: Self) {
        if self.contains(permission) {
            *self |= dependency;
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
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[repr(u8)]
pub enum Role {
    Admin = 2,
    Moderator = 1,
    User = 0,
}

impl TryFrom<u8> for Role {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::User),
            1 => Ok(Self::Moderator),
            2 => Ok(Self::Admin),
            _ => Err(()),
        }
    }
}

impl Role {
    pub const fn management_permissions(self) -> ManagementPermissions {
        match self {
            Self::Admin => ManagementPermissions::all(),
            Self::Moderator => ManagementPermissions::USER_VIEW,
            Self::User => ManagementPermissions::empty(),
        }
    }

    pub fn server_permissions(self) -> ServerPermissions {
        match self {
            Self::Admin => ServerPermissions::all(),
            Self::Moderator => {
                ServerPermissions::VIEW
                    | ServerPermissions::POWER
                    | ServerPermissions::TERMINAL_READ
            }
            Self::User => ServerPermissions::empty(),
        }
    }
}

impl ServerPermissions {
    pub fn grants(self, permission: Self) -> bool {
        self.contains(permission.with_dependencies())
    }
}
