use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ProjectPermissions;
use crate::db::database::ProjectInstance;
use crate::db::project::ProjectId;
use crate::service::database::{
    InstanceUserInfo, Provision, agent_failure, connection_info, validate_username,
};
use crate::service::error_database_agent_error::FromDatabaseAgentError;
use crate::service::error_database_engine_starting::FromDatabaseEngineStarting;
use crate::service::project_database::project_database_service_error::{
    CreateProjectDatabaseError, DeleteProjectDatabaseError, ListProjectDatabasesError,
};
use core::time::Duration;
use database_agent_common::service::database::DatabaseService as _;
use database_agent_common::service::database::database_service_error::CreateDatabaseError as AgentCreateDatabaseError;
use database_agent_common::service::instance::InstanceService as _;
use database_agent_common::service::user::UserService as _;
use database_agent_common::types::{
    ContainerState, DatabaseAccess, DatabaseType, PowerAction, StoredDatabase, StoredUser,
    UserGrant, validate_database_name,
};
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use uuid::Uuid;
use zelus::service;

const ENGINE_WAIT: Duration = Duration::from_secs(90);
const ENGINE_POLL: Duration = Duration::from_secs(2);

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectDatabaseInfo {
    /// The database's id, or the instance's id for engines without named databases.
    pub(crate) id: Uuid,
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) kind: DatabaseType,
    pub(crate) instance_id: Uuid,
    pub(crate) instance_display: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) state: ContainerState,
    pub(crate) suspended: bool,
    /// The users granted on this database, each with a connection string pointing at it.
    pub(crate) users: Vec<InstanceUserInfo>,
    pub(crate) created: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateProjectDatabase {
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) kind: DatabaseType,
}

fn database_info(
    instance: &ProjectInstance,
    state: ContainerState,
    suspended: bool,
    database: Option<&StoredDatabase>,
    users: Vec<StoredUser>,
) -> ProjectDatabaseInfo {
    let path = database.map_or("", |database| database.name.as_str());

    ProjectDatabaseInfo {
        id: database.map_or(instance.id, |database| database.uuid),
        name: database.map_or_else(
            || instance.display.clone(),
            |database| database.name.clone(),
        ),
        kind: instance.kind,
        instance_id: instance.id,
        instance_display: instance.display.clone(),
        host: instance.host.public_host.clone(),
        port: instance.host.port(instance.kind),
        state,
        suspended,
        users: users
            .into_iter()
            .map(|user| connection_info(instance, user, path))
            .collect(),
        created: database.map_or(instance.created, |database| database.created),
    }
}

async fn wait_for_engine<E>(instance: &ProjectInstance, deadline: Instant) -> Result<bool, E>
where
    E: FromDatabaseAgentError + FromDatabaseEngineStarting,
{
    let mut warming = false;

    loop {
        let remote = instance
            .host
            .sdk
            .get_instance(instance.id)
            .await
            .map_err(|err| agent_failure::<E>(&err))?;

        if remote.data.suspended {
            return Err(agent_failure::<E>(&"the instance is suspended"));
        }

        match remote.utilization.state {
            ContainerState::Running => return Ok(warming),
            ContainerState::Offline if !warming => {
                instance
                    .host
                    .sdk
                    .power_instance(instance.id, PowerAction::Start)
                    .await
                    .map_err(|err| agent_failure::<E>(&err))?;
            }
            ContainerState::Offline | ContainerState::Starting | ContainerState::Stopping => {}
        }

        warming = true;

        if Instant::now() >= deadline {
            return Err(<E as FromDatabaseEngineStarting>::from());
        }

        tokio::time::sleep(ENGINE_POLL).await;
    }
}

async fn create_named_database(
    instance: &ProjectInstance,
    name: &str,
    warming: bool,
    deadline: Instant,
) -> Result<StoredDatabase, CreateProjectDatabaseError> {
    loop {
        let error = match instance
            .host
            .sdk
            .create_database(instance.id, name.to_owned())
            .await
        {
            Ok(database) => return Ok(database),
            Err(AgentCreateDatabaseError::DatabaseNameTaken) => {
                return Err(CreateProjectDatabaseError::DatabaseNameTaken);
            }
            Err(AgentCreateDatabaseError::DatabaseNameInvalid) => {
                return Err(CreateProjectDatabaseError::DatabaseNameInvalid);
            }
            Err(error) => error,
        };

        if !warming {
            return Err(agent_failure(&error));
        }
        if Instant::now() >= deadline {
            tracing::warn!("The engine did not accept a new database in time: {error:?}");
            return Err(CreateProjectDatabaseError::DatabaseEngineStarting);
        }

        tokio::time::sleep(ENGINE_POLL).await;
    }
}

async fn create_owner(
    instance: &ProjectInstance,
    username: &str,
    grants: Vec<UserGrant>,
    warming: bool,
    deadline: Instant,
) -> Result<StoredUser, CreateProjectDatabaseError> {
    loop {
        let error = match instance
            .host
            .sdk
            .create_user(instance.id, username.to_owned(), grants.clone())
            .await
        {
            Ok(user) => return Ok(user),
            Err(error) => error,
        };

        if !warming {
            return Err(agent_failure(&error));
        }
        if Instant::now() >= deadline {
            tracing::warn!("The engine did not accept a new user in time: {error:?}");
            return Err(CreateProjectDatabaseError::DatabaseEngineStarting);
        }

        tokio::time::sleep(ENGINE_POLL).await;
    }
}

#[service(path = "/project/{project_id}/database", tag = "database", no_sdk)]
pub(crate) impl ProjectDatabaseService for Backend {
    /// Lists every database of the project across its instances, each with the
    /// users granted on it and their connection strings.
    ///
    /// Engines without named databases (Redis) are listed once per instance.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::agent_error, db::failure <- [sql:*])]
    async fn list_project_databases(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<Vec<ProjectDatabaseInfo>, _> {
        auth.require::<_, _, ListProjectDatabasesError>(
            project_id,
            ProjectPermissions::DATABASE_VIEW,
        )?;

        let instances = self
            .project_instances::<ListProjectDatabasesError>(project_id, None)
            .await?;

        let mut infos = Vec::new();
        for instance in instances {
            let remote = instance.host.sdk.get_instance(instance.id).await.ok();
            let state = remote
                .as_ref()
                .map_or(ContainerState::Offline, |remote| remote.utilization.state);
            let suspended = remote.is_some_and(|remote| remote.data.suspended);

            let users = instance
                .host
                .sdk
                .list_users(instance.id)
                .await
                .map_err(|err| agent_failure::<ListProjectDatabasesError>(&err))?;

            if !instance.kind.has_named_databases() {
                infos.push(database_info(&instance, state, suspended, None, users));
                continue;
            }

            let databases = instance
                .host
                .sdk
                .list_databases(instance.id)
                .await
                .map_err(|err| agent_failure::<ListProjectDatabasesError>(&err))?;

            for database in &databases {
                let granted = users
                    .iter()
                    .filter(|user| user.access(database.uuid).is_some())
                    .cloned()
                    .collect();
                infos.push(database_info(
                    &instance,
                    state,
                    suspended,
                    Some(database),
                    granted,
                ));
            }
        }

        infos.sort_by_key(|info| info.created);

        Ok(infos)
    }

    /// Creates a database together with a user that owns it.
    ///
    /// The database lands on the project's instance for the chosen engine. When
    /// the project has none yet, one is created and started first, which can take
    /// a while. Engines without named databases (Redis) get one instance per
    /// project, so a second one is refused.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{name_invalid, name_taken, limit_exceeded, type_unavailable,
            engine_starting, agent_error},
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

        let username: String = payload
            .name
            .chars()
            .take(database_agent_common::identifier::LABEL_MAX_LENGTH)
            .collect();
        if !validate_database_name(&payload.name) || !validate_username(&username) {
            return Err(CreateProjectDatabaseError::DatabaseNameInvalid);
        }

        let named = payload.kind.has_named_databases();
        let display = if named {
            payload.kind.to_string()
        } else {
            payload.name.clone()
        };

        let (instance, remote) = self
            .provision_instance::<CreateProjectDatabaseError>(
                project_id,
                payload.kind,
                display,
                Provision::Reuse,
            )
            .await?;

        if !named && remote.is_none() {
            return Err(CreateProjectDatabaseError::DatabaseLimitExceeded);
        }

        let deadline = Instant::now() + ENGINE_WAIT;
        let warming = wait_for_engine::<CreateProjectDatabaseError>(&instance, deadline).await?
            || remote.is_some();

        if !named {
            let user = create_owner(&instance, &username, Vec::new(), warming, deadline).await?;
            return Ok(database_info(
                &instance,
                ContainerState::Running,
                false,
                None,
                vec![user],
            ));
        }

        let database = create_named_database(&instance, &payload.name, warming, deadline).await?;

        let grants = vec![UserGrant {
            database_uuid: database.uuid,
            access: DatabaseAccess::Write,
        }];
        let user = match create_owner(&instance, &username, grants, warming, deadline).await {
            Ok(user) => user,
            Err(err) => {
                if let Err(cleanup) = instance
                    .host
                    .sdk
                    .delete_database(instance.id, database.uuid)
                    .await
                {
                    tracing::error!(
                        "Failed to roll back the database {}: {cleanup:?}",
                        database.uuid
                    );
                }
                return Err(err);
            }
        };

        Ok(database_info(
            &instance,
            ContainerState::Running,
            false,
            Some(&database),
            vec![user],
        ))
    }

    /// Deletes a database together with every user granted on it. For engines
    /// without named databases (Redis), `database_id` is the instance's id and
    /// the whole instance is deleted.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/{database_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn delete_project_database(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteProjectDatabaseError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<DeleteProjectDatabaseError>(project_id, instance_id)
            .await?;

        if instance.kind.has_named_databases() {
            instance
                .host
                .sdk
                .delete_database(instance.id, database_id)
                .await
                .map_err(|err| agent_failure::<DeleteProjectDatabaseError>(&err))?;
            self.delete_backup_job(instance.id, database_id).await?;
            return Ok(());
        }

        if database_id != instance.id {
            return Err(DeleteProjectDatabaseError::DatabaseInstanceNotFound);
        }

        self.remove_instance::<DeleteProjectDatabaseError>(instance)
            .await
    }
}
