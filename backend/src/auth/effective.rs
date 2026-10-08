use crate::auth::permissions::{
    ManagementPermissions, ProjectPermissions, Resolve, Role, Scope, ServerPermissions,
};
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use sqlx::{PgConnection, query, query_scalar};
use std::collections::HashMap;
use tracing::error;

#[derive(Debug, Default)]
pub struct EffectivePermissions {
    pub global: i64,
    projects: HashMap<ProjectId, i64>,
    servers: HashMap<ServerId, i64>,
    server_projects: HashMap<ServerId, ProjectId>,
}

impl EffectivePermissions {
    pub fn permissions<P: Resolve<S>, S>(&self, scope: S) -> P {
        P::resolve(scope, self)
    }

    pub fn has<P: Resolve<S>, S>(&self, scope: S, permission: P) -> bool {
        self.permissions::<P, S>(scope).grants(permission)
    }

    pub fn require<P: Resolve<S>, S: Scope<E>, E>(&self, scope: S, permission: P) -> Result<(), E> {
        if self.has(scope, permission) {
            Ok(())
        } else {
            Err(scope.denied(self))
        }
    }

    pub fn is_project_member(&self, project: ProjectId) -> bool {
        self.projects.contains_key(&project)
    }

    pub(crate) fn project(&self, project: ProjectId) -> i64 {
        self.projects.get(&project).copied().unwrap_or_default()
    }

    pub(crate) fn server(&self, server: ServerId) -> i64 {
        self.servers.get(&server).copied().unwrap_or(self.global)
    }

    pub async fn load(
        conn: &mut PgConnection,
        id: i32,
        role: Option<Role>,
    ) -> Result<Self, sqlx::Error> {
        let permissions = role
            .map(|role| {
                role.management_permissions().bits()
                    | role.project_permissions().bits()
                    | role.server_permissions().bits()
            })
            .unwrap_or_default();

        let owned_projects: HashMap<_, _> = query_scalar!(
            r#"SELECT id AS "id: ProjectId" FROM projects WHERE owner = $1"#,
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| {
            error!("Unable to fetch owned servers for user {id}: {err:?}");
        })?
        .into_iter()
        .map(|id| {
            (
                id,
                ProjectPermissions::all().bits() | ServerPermissions::all().bits(),
            )
        })
        .collect();

        let mut projects: HashMap<ProjectId, i64> = query!(
            r#"SELECT project AS "project: ProjectId", permissions
             FROM project_users
             WHERE "user" = $1
               AND (expires_at IS NULL OR expires_at > now())"#,
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch project permissions for user {id}: {err:?}"))?
        .into_iter()
        .map(|record| (record.project, record.permissions))
        .collect();
        projects.extend(owned_projects);

        let server_records = query!(
            r#"SELECT
                servers.id AS "server: ServerId",
                servers.project AS "project: ProjectId",
                servers.suspended AS "suspended: bool",
                nodes.maintenance AS "maintenance: bool"
             FROM servers
             JOIN nodes ON nodes.id = servers.node
             JOIN projects ON projects.id = servers.project
             LEFT JOIN project_users
                ON project_users.project = servers.project
                AND project_users."user" = $1
                AND (project_users.expires_at IS NULL OR project_users.expires_at > now())
             WHERE projects.owner = $2
                OR project_users."user" IS NOT NULL
                OR $3"#,
            &id,
            &id,
            ProjectPermissions::from_bits_retain(permissions).contains(ProjectPermissions::VIEW),
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch server permissions for user {id}: {err:?}"))?;

        let mut servers = HashMap::new();
        let mut server_projects = HashMap::new();
        for record in server_records {
            let server_permissions = projects
                .get(&record.project)
                .copied()
                .unwrap_or(permissions);

            let server_permissions = if (record.suspended
                && !ManagementPermissions::from_bits_retain(permissions)
                    .contains(ManagementPermissions::SERVER_SUSPEND))
                || (record.maintenance
                    && !ManagementPermissions::from_bits_retain(permissions)
                        .contains(ManagementPermissions::SERVER_MANAGE))
            {
                ProjectPermissions::VIEW.bits()
            } else {
                server_permissions
            };

            if ProjectPermissions::from_bits_retain(server_permissions)
                .contains(ProjectPermissions::VIEW)
            {
                servers.insert(record.server, server_permissions);
                server_projects.insert(record.server, record.project);
            }
        }

        Ok(Self {
            global: permissions,
            projects,
            servers,
            server_projects,
        })
    }

    #[must_use]
    pub fn masked(self, mask: i64, project: Option<ProjectId>) -> Self {
        let Some(project) = project else {
            return Self {
                global: self.global & mask,
                projects: self
                    .projects
                    .into_iter()
                    .map(|(id, permissions)| (id, permissions & mask))
                    .collect(),
                servers: self
                    .servers
                    .into_iter()
                    .map(|(id, permissions)| (id, permissions & mask))
                    .collect(),
                server_projects: self.server_projects,
            };
        };

        let projects = HashMap::from([(
            project,
            (self.projects.get(&project).copied().unwrap_or_default() | self.global) & mask,
        )]);
        let servers = self
            .servers
            .iter()
            .filter(|(id, _)| self.server_projects.get(*id) == Some(&project))
            .map(|(id, permissions)| (*id, permissions & mask))
            .collect();

        Self {
            global: 0,
            projects,
            servers,
            server_projects: self.server_projects,
        }
    }
}
