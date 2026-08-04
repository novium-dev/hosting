use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions};
use crate::db::database::{BackendDatabaseHost, DatabaseId, MAX_PROJECT_DATABASES};
use crate::db::project::ProjectId;
use crate::db::region::RegionId;
use crate::service::database::database_service_error::{
    CreateProjectDatabaseError, DeleteProjectDatabaseError, GetProjectDatabaseError,
    ListProjectDatabasesError, RotateProjectDatabasePasswordError,
};
use crate::service::error_database_agent_error::FromDatabaseAgentError;
use core::str::FromStr as _;
use database_agent_common::service::database::DatabaseService as _;
use database_agent_common::service::user::UserService as _;
use database_agent_common::types::DatabaseType;
use rand::RngExt as _;
use serde::{Deserialize, Serialize};
use sqlx::{query, query_scalar};
use std::sync::Arc;
use uuid::Uuid;
use zelus::service;

const NAME_MIN_LENGTH: usize = 2;
const NAME_MAX_LENGTH: usize = 20;

fn validate_name(name: &str) -> bool {
    (NAME_MIN_LENGTH..=NAME_MAX_LENGTH).contains(&name.len())
        && name
            .chars()
            .all(|char| char.is_ascii_lowercase() || char.is_ascii_digit())
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectDatabaseInfo {
    pub(crate) id: DatabaseId,
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) kind: DatabaseType,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) database: String,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) uri: String,
    pub(crate) created: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateProjectDatabase {
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) kind: DatabaseType,
}

struct StoredProjectDatabase {
    id: DatabaseId,
    name: String,
    remote_name: String,
    kind: DatabaseType,
    instance: Uuid,
    host: Arc<BackendDatabaseHost>,
    remote_database: Uuid,
    remote_user: Uuid,
    username: String,
    password: String,
    created: chrono::DateTime<chrono::Utc>,
}

impl StoredProjectDatabase {
    fn info(self) -> ProjectDatabaseInfo {
        let host = self.host.public_host.clone();
        let port = self.host.port(self.kind);
        let path = if self.kind.has_named_databases() {
            self.remote_name.as_str()
        } else {
            ""
        };

        ProjectDatabaseInfo {
            uri: format!(
                "{}://{}:{}@{host}:{port}/{path}",
                self.kind.uri_scheme(),
                self.username,
                self.password
            ),
            id: self.id,
            name: self.name,
            kind: self.kind,
            host,
            port,
            database: self.remote_name,
            username: self.username,
            password: self.password,
            created: self.created,
        }
    }
}

impl Backend {
    async fn stored_databases<E: From<sqlx::Error>>(
        &self,
        project: ProjectId,
        database: Option<DatabaseId>,
    ) -> Result<Vec<StoredProjectDatabase>, E> {
        let filter = database.map(|id| id.to_string());

        let rows = query!(
            r#"SELECT project_databases.id AS "id: DatabaseId", project_databases.name,
                   project_databases.remote_name, project_databases.instance,
                   project_databases.remote_database, project_databases.remote_user,
                   project_databases.username, project_databases.password,
                   project_databases.created, database_instances.type AS kind,
                   database_instances.host
               FROM project_databases
               JOIN database_instances ON database_instances.id = project_databases.instance
               WHERE project_databases.project = $1
                 AND ($2::text IS NULL OR project_databases.id = $2)
               ORDER BY project_databases.created"#,
            &project,
            filter.as_deref()
        )
        .fetch_all(&*self.database)
        .await?;

        let hosts = self.database_hosts.read().await;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(StoredProjectDatabase {
                    id: row.id,
                    name: row.name,
                    remote_name: row.remote_name,
                    kind: DatabaseType::from_str(&row.kind).ok()?,
                    instance: row.instance,
                    host: Arc::clone(hosts.get(&row.host)?),
                    remote_database: row.remote_database,
                    remote_user: row.remote_user,
                    username: row.username,
                    password: row.password,
                    created: row.created,
                })
            })
            .collect())
    }

    async fn pick_database_instance<E: From<sqlx::Error>>(
        &self,
        project: ProjectId,
        kind: DatabaseType,
    ) -> Result<Option<(Uuid, Arc<BackendDatabaseHost>)>, E> {
        let region = query_scalar!(
            r#"SELECT nodes.region AS "region: RegionId"
               FROM servers
               JOIN nodes ON nodes.id = servers.node
               WHERE servers.project = $1
               LIMIT 1"#,
            &project
        )
        .fetch_optional(&*self.database)
        .await?;

        let candidates = query!(
            r#"SELECT database_instances.id, database_instances.host,
                   (SELECT COUNT(*) FROM project_databases
                    WHERE project_databases.instance = database_instances.id) AS "load!"
               FROM database_instances
               WHERE database_instances.type = $1
               ORDER BY 3 ASC"#,
            kind.as_str()
        )
        .fetch_all(&*self.database)
        .await?;

        let hosts = self.database_hosts.read().await;

        let mut preferred = None;
        let mut fallback = None;
        for candidate in candidates {
            let Some(host) = hosts.get(&candidate.host) else {
                continue;
            };
            if host.maintenance {
                continue;
            }

            if region.is_some_and(|region| region == host.region) {
                preferred = Some((candidate.id, Arc::clone(host)));
                break;
            }
            if fallback.is_none() {
                fallback = Some((candidate.id, Arc::clone(host)));
            }
        }
        drop(hosts);

        Ok(preferred.or(fallback))
    }
}

fn agent_failure<E: FromDatabaseAgentError>(error: &impl core::fmt::Debug) -> E {
    tracing::error!("The database agent returned an error: {error:?}");
    <E as FromDatabaseAgentError>::from()
}

#[service(path = "/project/{project_id}/database", tag = "database", no_sdk)]
pub(crate) impl DatabaseService for Backend {
    /// Lists the databases of a project, including their connection details.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found, db::failure <- [sql:*])]
    async fn list_project_databases(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<Vec<ProjectDatabaseInfo>, _> {
        auth.require::<_, _, ListProjectDatabasesError>(
            project_id,
            ProjectPermissions::DATABASE_VIEW,
        )?;

        Ok(self
            .stored_databases::<ListProjectDatabasesError>(project_id, None)
            .await?
            .into_iter()
            .map(StoredProjectDatabase::info)
            .collect())
    }

    /// Returns a single project database with its connection details.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_VIEW`].
    #[route("/{database_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found, database::not_found, db::failure <- [sql:*])]
    async fn get_project_database(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        database_id: DatabaseId,
    ) -> Result<ProjectDatabaseInfo, _> {
        auth.require::<_, _, GetProjectDatabaseError>(
            project_id,
            ProjectPermissions::DATABASE_VIEW,
        )?;

        self.stored_databases::<GetProjectDatabaseError>(project_id, Some(database_id))
            .await?
            .pop()
            .map(StoredProjectDatabase::info)
            .ok_or(GetProjectDatabaseError::DatabaseNotFound)
    }

    /// Creates a database for the project on a matching database host.
    ///
    /// A project may hold up to four databases; going beyond that requires
    /// [`ManagementPermissions::LIMITS_BYPASS`].
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{name_invalid, name_taken, limit_exceeded, type_unavailable, agent_error},
        db::failure <- [sql:*])]
    async fn create_project_database(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        payload: CreateProjectDatabase,
    ) -> Result<ProjectDatabaseInfo, _> {
        auth.require::<_, _, CreateProjectDatabaseError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        if !validate_name(&payload.name) {
            return Err(CreateProjectDatabaseError::DatabaseNameInvalid);
        }

        let count = query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM project_databases WHERE project = $1"#,
            &project_id
        )
        .fetch_one(&*self.database)
        .await?;

        let may_bypass = auth
            .require::<_, _, CreateProjectDatabaseError>((), ManagementPermissions::LIMITS_BYPASS)
            .is_ok();
        if count >= MAX_PROJECT_DATABASES && !may_bypass {
            return Err(CreateProjectDatabaseError::DatabaseLimitExceeded);
        }

        let taken = query_scalar!(
            r#"SELECT (COUNT(*) > 0) AS "taken!" FROM project_databases
               WHERE project = $1 AND name = $2"#,
            &project_id,
            payload.name
        )
        .fetch_one(&*self.database)
        .await?;
        if taken {
            return Err(CreateProjectDatabaseError::DatabaseNameTaken);
        }

        let (instance, host) = self
            .pick_database_instance::<CreateProjectDatabaseError>(project_id, payload.kind)
            .await?
            .ok_or(CreateProjectDatabaseError::DatabaseTypeUnavailable)?;

        let suffix: u32 = rand::rng().random();
        let remote_name = format!("{}{suffix:08x}", payload.name);

        let remote_database = host
            .sdk
            .create_database(instance, remote_name.clone())
            .await
            .map_err(|err| agent_failure::<CreateProjectDatabaseError>(&err))?;

        let remote_user = match host
            .sdk
            .create_user(instance, payload.name.clone(), Some(remote_database.uuid))
            .await
        {
            Ok(user) => user,
            Err(err) => {
                if let Err(cleanup) = host
                    .sdk
                    .delete_database(instance, remote_database.uuid)
                    .await
                {
                    tracing::error!(
                        "Failed to roll back the remote database {}: {cleanup:?}",
                        remote_database.uuid
                    );
                }
                return Err(agent_failure(&err));
            }
        };

        let id = DatabaseId::generate();
        let username = remote_user.identifier();

        query!(
            "INSERT INTO project_databases (id, project, instance, name, remote_name,
                 remote_database, remote_user, username, password)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
            &id,
            &project_id,
            instance,
            payload.name,
            remote_name,
            remote_database.uuid,
            remote_user.uuid,
            username,
            remote_user.password
        )
        .execute(&*self.database)
        .await?;

        Ok(StoredProjectDatabase {
            id,
            name: payload.name,
            remote_name,
            kind: payload.kind,
            instance,
            host,
            remote_database: remote_database.uuid,
            remote_user: remote_user.uuid,
            username,
            password: remote_user.password,
            created: remote_user.created,
        }
        .info())
    }

    /// Deletes a project database together with its user on the database host.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{database_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{not_found, agent_error}, db::failure <- [sql:*])]
    async fn delete_project_database(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        database_id: DatabaseId,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteProjectDatabaseError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let stored = self
            .stored_databases::<DeleteProjectDatabaseError>(project_id, Some(database_id))
            .await?
            .pop()
            .ok_or(DeleteProjectDatabaseError::DatabaseNotFound)?;

        stored
            .host
            .sdk
            .delete_database(stored.instance, stored.remote_database)
            .await
            .map_err(|err| agent_failure::<DeleteProjectDatabaseError>(&err))?;

        query!("DELETE FROM project_databases WHERE id = $1", &database_id)
            .execute(&*self.database)
            .await?;

        Ok(())
    }

    /// Replaces the database user's password with a freshly generated one.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{database_id}/rotate", method = POST)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{not_found, agent_error}, db::failure <- [sql:*])]
    async fn rotate_project_database_password(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        database_id: DatabaseId,
    ) -> Result<ProjectDatabaseInfo, _> {
        auth.require::<_, _, RotateProjectDatabasePasswordError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let mut stored = self
            .stored_databases::<RotateProjectDatabasePasswordError>(project_id, Some(database_id))
            .await?
            .pop()
            .ok_or(RotateProjectDatabasePasswordError::DatabaseNotFound)?;

        let password = stored
            .host
            .sdk
            .rotate_user_password(stored.instance, stored.remote_user)
            .await
            .map_err(|err| agent_failure::<RotateProjectDatabasePasswordError>(&err))?;

        query!(
            "UPDATE project_databases SET password = $1 WHERE id = $2",
            password,
            &database_id
        )
        .execute(&*self.database)
        .await?;

        stored.password = password;

        Ok(stored.info())
    }
}
