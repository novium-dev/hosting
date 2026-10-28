use crate::auth::effective::EffectivePermissions;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::error_project_not_found::FromProjectNotFound;
use crate::service::error_server_not_found::FromServerNotFound;
use bitflags::{Flags, bitflags};
use serde::{Deserialize, Serialize};

pub trait PermissionSet: Flags + Copy + Default {
    const DEPENDENCIES: &'static [(Self, Self)];

    #[must_use]
    fn with_dependencies(mut self) -> Self {
        for &(permission, dependency) in Self::DEPENDENCIES {
            if self.contains(permission) {
                self.insert(dependency);
            }
        }
        self
    }

    fn grants(self, permission: Self) -> bool {
        self.contains(permission.with_dependencies())
    }
}

pub trait Resolve<S>: PermissionSet {
    fn resolve(scope: S, access: &EffectivePermissions) -> Self;
}

pub trait Scope<E>: Copy {
    fn denied(self, access: &EffectivePermissions) -> E;
}

impl<E: FromAuthPermissionDenied> Scope<E> for () {
    fn denied(self, _access: &EffectivePermissions) -> E {
        E::from()
    }
}

impl<E: FromAuthPermissionDenied + FromProjectNotFound> Scope<E> for ProjectId {
    fn denied(self, access: &EffectivePermissions) -> E {
        if access.has(self, ProjectPermissions::VIEW) {
            <E as FromAuthPermissionDenied>::from()
        } else {
            <E as FromProjectNotFound>::from()
        }
    }
}

impl<E: FromAuthPermissionDenied + FromServerNotFound> Scope<E> for ServerId {
    fn denied(self, access: &EffectivePermissions) -> E {
        if access.has(self, ProjectPermissions::VIEW) {
            <E as FromAuthPermissionDenied>::from()
        } else {
            <E as FromServerNotFound>::from()
        }
    }
}

bitflags! {
    /// Permission set on a per-project basis.
    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default)]
    #[repr(transparent)]
    pub struct ProjectPermissions: i64 {
        /// Allows the user to see the project and its servers.
        const VIEW = 1 << 0;
        /// Allows the user to view project members.
        const USER_VIEW = 1 << 13;
        /// Allows the user to modify project members.
        const USER_EDIT = 1 << 14;
        /// Allows the user to manage project metadata and servers.
        const ADMIN_MANAGEMENT = 1 << 16;

        /// Allows the user to see the project's databases and their connection details.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const DATABASE_VIEW = 1 << 19;
        /// Allows the user to create and delete the project's databases and to
        /// rotate their passwords.
        ///
        /// Depends on [`ProjectPermissions::DATABASE_VIEW`]
        const DATABASE_MANAGE = 1 << 20;
    }

    /// Permission set on a per-server basis
    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default)]
    #[repr(transparent)]
    pub struct ServerPermissions: i64 {
        /// Allows the user to start, stop, restart and kill the server.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const POWER = 1 << 1;

        /// Allows the user to see the content on the server terminal.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const TERMINAL_READ = 1 << 2;
        /// Allows the user to write contents into the console, assuming the server software allows it.
        ///
        /// Depends on [`ServerPermissions::TERMINAL_READ`]
        const TERMINAL_WRITE = 1 << 3;

        /// Allows the user to view the server settings that are set for the selected template.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const BUILD_VIEW = 1 << 4;
        /// Allows the user to modify the server settings.
        /// It does not allow the change of the selected template.
        ///
        /// Depends on [`ServerPermissions::BUILD_VIEW`]
        const BUILD_EDIT = 1 << 5;

        /// Allows the user to access files.
        /// It does not allow modification of the files in any way.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const FILES_READ = 1 << 6;
        /// Allows the user to modify files.
        ///
        /// Depends on [`ServerPermissions::FILES_READ`]
        const FILES_WRITE = 1 << 7;

        /// Allows the user to view existing backups.
        /// It does not allow to view the contents of the backup.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
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

        /// Allows the user to view the server's network configuration (assigned ports).
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const NETWORK_VIEW = 1 << 15;

        /// Allows the user to view the routes (subdomains) pointing at the server.
        ///
        /// Depends on [`ServerPermissions::NETWORK_VIEW`]
        const ROUTES_VIEW = 1 << 17;
        /// Allows the user to create and delete routes for the server.
        ///
        /// Depends on [`ServerPermissions::ROUTES_VIEW`]
        const ROUTES_MANAGE = 1 << 18;

        /// Allows the user to see the server's schedules and the steps they run.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const SCHEDULE_VIEW = 1 << 21;
        /// Allows the user to create, edit and delete the server's schedules.
        ///
        /// Depends on [`ServerPermissions::SCHEDULE_VIEW`]
        const SCHEDULE_MANAGE = 1 << 22;
    }

    #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
    #[repr(transparent)]
    pub struct ManagementPermissions: i64 {
        /// Allows the user to change the
        /// - selected template
        /// - resource quota (cpu, memory, swap and disk)
        /// - internet access
        /// - limits (backup)
        /// - network ports
        /// of a server.
        /// Also allows the user to create and delete servers.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const SERVER_MANAGE = 1 << 32;
        /// Allows the user to suspend a server.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
        const SERVER_SUSPEND = 1 << 33;
        /// Allows the user to delete a server.
        ///
        /// Depends on [`ProjectPermissions::VIEW`]
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

        /// Allows the user to bypass global and server-specific limits.
        ///
        const LIMITS_BYPASS = 1 << 46;

        /// Allows the user to view all route domains on this instance, including private ones.
        ///
        const DOMAINS_VIEW = 1 << 48;
        /// Allows the user to create, edit and delete route domains on this instance.
        ///
        /// Depends on [`ManagementPermissions::DOMAINS_VIEW`]
        const DOMAINS_MANAGE = 1 << 49;

        /// Allows the user to view all registered database hosts on this instance.
        ///
        const DATABASE_HOSTS_VIEW = 1 << 50;
        /// Allows the user to register, edit and unregister database hosts.
        ///
        /// Depends on [`ManagementPermissions::DATABASE_HOSTS_VIEW`]
        const DATABASE_HOSTS_MANAGE = 1 << 51;

        /// Allows the user to run integrity checks against this instance, its
        /// nodes and its database hosts, and to read the reports they produce.
        ///
        const INTEGRITY_VIEW = 1 << 52;

        /// Allows the user to deploy servers from deploy configs into any project. The node is
        /// picked automatically from the config's group.
        ///
        const SERVER_DEPLOY = 1 << 44;

        /// Allows the user to perform self-service actions this instance has disabled,
        /// such as creating projects or changing a project's name, slug or logo.
        ///
        const BYPASS_INSTANCE_RESTRICTIONS = 1 << 47;
    }
}

impl PermissionSet for ProjectPermissions {
    const DEPENDENCIES: &'static [(Self, Self)] = &[
        (Self::USER_EDIT, Self::USER_VIEW),
        (Self::DATABASE_MANAGE, Self::DATABASE_VIEW),
    ];

    fn with_dependencies(mut self) -> Self {
        if !self.is_empty() {
            self |= Self::VIEW;
        }
        for &(permission, dependency) in Self::DEPENDENCIES {
            if self.contains(permission) {
                self |= dependency;
            }
        }
        self
    }
}

impl PermissionSet for ServerPermissions {
    const DEPENDENCIES: &'static [(Self, Self)] = &[
        (Self::TERMINAL_WRITE, Self::TERMINAL_READ),
        (Self::BUILD_EDIT, Self::BUILD_VIEW),
        (Self::FILES_WRITE, Self::FILES_READ),
        (Self::BACKUP_DOWNLOAD, Self::BACKUP_VIEW),
        (Self::BACKUP_CREATE, Self::BACKUP_VIEW),
        (Self::BACKUP_DELETE, Self::BACKUP_VIEW),
        (Self::BACKUP_RESTORE, Self::BACKUP_VIEW),
        (Self::ROUTES_VIEW, Self::NETWORK_VIEW),
        (
            Self::ROUTES_MANAGE,
            Self::ROUTES_VIEW.union(Self::NETWORK_VIEW),
        ),
        (Self::SCHEDULE_MANAGE, Self::SCHEDULE_VIEW),
    ];
}

impl PermissionSet for ManagementPermissions {
    const DEPENDENCIES: &'static [(Self, Self)] = &[
        (Self::USER_MANAGE, Self::USER_VIEW),
        (Self::API_KEYS_MANAGE, Self::API_KEYS_VIEW),
        (Self::NODES_MANAGE, Self::NODES_VIEW),
        (Self::DOMAINS_MANAGE, Self::DOMAINS_VIEW),
        (Self::DATABASE_HOSTS_MANAGE, Self::DATABASE_HOSTS_VIEW),
    ];
}

impl Resolve<ProjectId> for ProjectPermissions {
    fn resolve(project: ProjectId, access: &EffectivePermissions) -> Self {
        Self::from_bits_retain(access.project(project) | access.global)
    }
}

impl Resolve<ServerId> for ProjectPermissions {
    fn resolve(server: ServerId, access: &EffectivePermissions) -> Self {
        Self::from_bits_retain(access.server(server))
    }
}

impl Resolve<ServerId> for ServerPermissions {
    fn resolve(server: ServerId, access: &EffectivePermissions) -> Self {
        if access.has(server, ProjectPermissions::VIEW) {
            Self::from_bits_retain(access.server(server))
        } else {
            Self::empty()
        }
    }
}

impl Resolve<()> for ManagementPermissions {
    fn resolve((): (), access: &EffectivePermissions) -> Self {
        Self::from_bits_retain(access.global)
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
    pub fn from_db(value: i32) -> Option<Self> {
        Self::try_from(u8::try_from(value).ok()?).ok()
    }

    pub const fn management_permissions(self) -> ManagementPermissions {
        match self {
            Self::Admin => ManagementPermissions::all(),
            Self::Moderator => ManagementPermissions::from_bits_retain(
                ManagementPermissions::USER_VIEW.bits()
                    | ManagementPermissions::SERVER_SUSPEND.bits(),
            ),
            Self::User => ManagementPermissions::empty(),
        }
    }

    pub const fn project_permissions(self) -> ProjectPermissions {
        match self {
            Self::Admin | Self::Moderator => ProjectPermissions::all(),
            Self::User => ProjectPermissions::empty(),
        }
    }

    pub const fn server_permissions(self) -> ServerPermissions {
        match self {
            Self::Admin | Self::Moderator => ServerPermissions::all(),
            Self::User => ServerPermissions::empty(),
        }
    }
}
