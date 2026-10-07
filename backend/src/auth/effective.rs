use crate::auth::grant::resolve_grant;
use crate::auth::permissions::{
    ManagementPermissions, ProjectPermissions, Role, ServerPermissions,
};
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use sqlx::{PgConnection, query, query_scalar};
use std::collections::HashMap;
use tracing::error;

pub struct EffectivePermissions {
    pub permissions: i64,
    pub projects: HashMap<ProjectId, i64>,
    pub servers: HashMap<ServerId, i64>,
    server_projects: HashMap<ServerId, ProjectId>,
}

impl EffectivePermissions {
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
            r#"SELECT project AS "project: ProjectId", permissions, known_permissions
             FROM project_users
             WHERE "user" = $1
               AND (expires_at IS NULL OR expires_at > now())"#,
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch project permissions for user {id}: {err:?}"))?
        .into_iter()
        .map(|record| {
            (
                record.project,
                resolve_grant(record.permissions, record.known_permissions),
            )
        })
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
            permissions,
            projects,
            servers,
            server_projects,
        })
    }

    #[must_use]
    pub fn masked(self, mask: i64, project: Option<ProjectId>) -> Self {
        let Some(project) = project else {
            return Self {
                permissions: self.permissions & mask,
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
            (self.projects.get(&project).copied().unwrap_or_default() | self.permissions) & mask,
        )]);
        let servers = self
            .servers
            .iter()
            .filter(|(id, _)| self.server_projects.get(*id) == Some(&project))
            .map(|(id, permissions)| (*id, permissions & mask))
            .collect();

        Self {
            permissions: 0,
            projects,
            servers,
            server_projects: self.server_projects,
        }
    }
}
