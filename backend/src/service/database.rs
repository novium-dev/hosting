use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions};
use crate::db::database::{MAX_PROJECT_INSTANCES, ProjectInstance};
use crate::db::project::ProjectId;
use crate::service::database::database_service_error::{
    CreateInstanceDatabaseError, CreateInstanceUserError, CreateProjectInstanceError,
    DeleteInstanceDatabaseError, DeleteInstanceUserError, DeleteProjectInstanceError,
    ListInstanceDatabasesError, ListInstanceUsersError, ListProjectInstancesError,
    PowerProjectInstanceError, RotateInstanceUserPasswordError, SetInstanceUserGrantsError,
};
use crate::service::error_database_agent_error::FromDatabaseAgentError;
use crate::service::error_database_instance_not_found::FromDatabaseInstanceNotFound;
use database_agent_common::identifier::{LABEL_MAX_LENGTH, LABEL_MIN_LENGTH};
use database_agent_common::service::database::DatabaseService as _;
use database_agent_common::service::instance::InstanceService as _;
use database_agent_common::service::user::UserService as _;
use database_agent_common::types::{
    ContainerState, DatabaseType, PowerAction, ResourceUsage, StoredDatabase, StoredUser,
    UserGrant, validate_database_name,
};
use serde::{Deserialize, Serialize};
use sqlx::{query, query_scalar};
use tracing::debug;
use uuid::Uuid;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectInstanceInfo {
    pub(crate) id: Uuid,
    #[serde(rename = "type")]
    pub(crate) kind: DatabaseType,
    pub(crate) display: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) state: ContainerState,
    pub(crate) utilization: Option<ResourceUsage>,
    pub(crate) memory_limit: Option<i64>,
    pub(crate) disk_limit: Option<i64>,
    pub(crate) suspended: bool,
    pub(crate) created: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateProjectInstance {
    pub(crate) display: String,
    #[serde(rename = "type")]
    pub(crate) kind: DatabaseType,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstanceDatabaseInfo {
    #[serde(flatten)]
    pub(crate) database: StoredDatabase,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstanceUserInfo {
    #[serde(flatten)]
    pub(crate) user: StoredUser,
    /// The name the client connects with, which carries the user's short uuid.
    pub(crate) identifier: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) uri: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateInstanceDatabase {
    pub(crate) name: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateInstanceUser {
    pub(crate) username: String,
    /// The databases the user is granted on, each with its access level.
    #[serde(default)]
    pub(crate) grants: Vec<UserGrant>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct SetInstanceUserGrants {
    /// Replaces the user's grants; a database left out means no access.
    #[serde(default)]
    pub(crate) grants: Vec<UserGrant>,
}

fn agent_failure<E: FromDatabaseAgentError>(error: &impl core::fmt::Debug) -> E {
    tracing::error!("The database agent returned an error: {error:?}");
    <E as FromDatabaseAgentError>::from()
}

fn validate_username(username: &str) -> bool {
    (LABEL_MIN_LENGTH..=LABEL_MAX_LENGTH).contains(&username.len())
        && username.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// The database the connection string points at: the one the user can write
/// to, falling back to the first it may read.
fn default_database<'a>(user: &StoredUser, databases: &'a [StoredDatabase]) -> Option<&'a str> {
    let mut grants = user.grants.clone();
    grants.sort_by_key(|grant| !grant.access.is_write());

    grants.iter().find_map(|grant| {
        databases
            .iter()
            .find(|database| database.uuid == grant.database_uuid)
            .map(|database| database.name.as_str())
    })
}

fn user_info(
    instance: &ProjectInstance,
    user: StoredUser,
    databases: &[StoredDatabase],
) -> InstanceUserInfo {
    let identifier = user.identifier();
    let host = instance.host.public_host.clone();
    let port = instance.host.port(instance.kind);
    let path = if instance.kind.has_named_databases() {
        default_database(&user, databases).unwrap_or_default()
    } else {
        ""
    };

    InstanceUserInfo {
        uri: format!(
            "{}://{identifier}:{}@{host}:{port}/{path}",
            instance.kind.uri_scheme(),
            user.password
        ),
        identifier,
        host,
        port,
        user,
    }
}

impl Backend {
    async fn require_instance<E>(
        &self,
        project: ProjectId,
        instance: Uuid,
    ) -> Result<ProjectInstance, E>
    where
        E: From<sqlx::Error> + FromDatabaseInstanceNotFound,
    {
        self.project_instances::<E>(project, Some(instance))
            .await?
            .pop()
            .ok_or_else(<E as FromDatabaseInstanceNotFound>::from)
    }
}

#[service(path = "/project/{project_id}/instance", tag = "database", no_sdk)]
pub(crate) impl DatabaseService for Backend {
    /// Lists the project's database instances with their live state.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found, db::failure <- [sql:*])]
    async fn list_project_instances(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<Vec<ProjectInstanceInfo>, _> {
        auth.require::<_, _, ListProjectInstancesError>(
            project_id,
            ProjectPermissions::DATABASE_VIEW,
        )?;

        let instances = self
            .project_instances::<ListProjectInstancesError>(project_id, None)
            .await?;

        let mut infos = Vec::with_capacity(instances.len());
        for instance in instances {
            let remote = instance.host.sdk.get_instance(instance.id).await.ok();

            infos.push(ProjectInstanceInfo {
                id: instance.id,
                kind: instance.kind,
                display: instance.display,
                host: instance.host.public_host.clone(),
                port: instance.host.port(instance.kind),
                state: remote
                    .as_ref()
                    .map_or(ContainerState::Offline, |remote| remote.utilization.state),
                memory_limit: remote.as_ref().map(|remote| remote.data.memory),
                disk_limit: remote.as_ref().map(|remote| remote.data.disk),
                suspended: remote.as_ref().is_some_and(|remote| remote.data.suspended),
                utilization: remote.map(|remote| remote.utilization),
                created: instance.created,
            });
        }

        Ok(infos)
    }

    /// Creates a database instance for the project.
    ///
    /// The project picks only the engine; its image and limits come from the
    /// instance defaults in the backend config. A project may own up to four
    /// instances, or more with [`ManagementPermissions::LIMITS_BYPASS`].
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{limit_exceeded, type_unavailable, agent_error}, db::failure <- [sql:*])]
    async fn create_project_instance(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        payload: CreateProjectInstance,
    ) -> Result<ProjectInstanceInfo, _> {
        auth.require::<_, _, CreateProjectInstanceError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let mut tx = self.database.begin().await?;

        let count = query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM database_instances WHERE project = $1"#,
            &project_id
        )
        .fetch_one(&mut *tx)
        .await?;

        let may_bypass = auth
            .require::<_, _, CreateProjectInstanceError>((), ManagementPermissions::LIMITS_BYPASS)
            .is_ok();
        if count >= MAX_PROJECT_INSTANCES && !may_bypass {
            return Err(CreateProjectInstanceError::DatabaseLimitExceeded);
        }

        let defaults = self
            .config
            .databases
            .defaults_for(payload.kind)
            .ok_or(CreateProjectInstanceError::DatabaseTypeUnavailable)?;

        debug!(
            "Creating a new {} instance for project {project_id} with defaults: {defaults:?}",
            payload.kind
        );

        let host = self
            .pick_database_host::<CreateProjectInstanceError>(project_id)
            .await?
            .ok_or(CreateProjectInstanceError::DatabaseTypeUnavailable)?;

        let remote = host
            .sdk
            .create_instance(defaults.to_create(payload.kind))
            .await
            .map_err(|err| agent_failure::<CreateProjectInstanceError>(&err))?;

        let created = chrono::Utc::now();
        let stored = async {
            query!(
                "INSERT INTO database_instances (id, host, project, kind, display, created)
                 VALUES ($1, $2, $3, $4, $5, $6)",
                remote.data.uuid,
                host.id,
                &project_id,
                payload.kind.as_str(),
                payload.display,
                created
            )
            .execute(&mut *tx)
            .await?;
            tx.commit().await
        }
        .await;

        if let Err(err) = stored {
            if let Err(cleanup) = host.sdk.delete_instance(remote.data.uuid).await {
                tracing::error!(
                    "Failed to roll back the remote instance {}: {cleanup:?}",
                    remote.data.uuid
                );
            }
            return Err(err.into());
        }

        if let Err(err) = host
            .sdk
            .power_instance(remote.data.uuid, PowerAction::Start)
            .await
        {
            tracing::warn!(
                "Failed to start the new instance {}: {err:?}",
                remote.data.uuid
            );
        }

        Ok(ProjectInstanceInfo {
            id: remote.data.uuid,
            kind: payload.kind,
            display: payload.display,
            host: host.public_host.clone(),
            port: host.port(payload.kind),
            state: ContainerState::Starting,
            utilization: None,
            memory_limit: Some(remote.data.memory),
            disk_limit: Some(remote.data.disk),
            suspended: remote.data.suspended,
            created,
        })
    }

    /// Deletes an instance together with everything stored in it.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn delete_project_instance(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteProjectInstanceError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<DeleteProjectInstanceError>(project_id, instance_id)
            .await?;

        let mut tx = self.database.begin().await?;

        query!("DELETE FROM database_instances WHERE id = $1", instance.id)
            .execute(&mut *tx)
            .await?;

        instance
            .host
            .sdk
            .delete_instance(instance.id)
            .await
            .map_err(|err| agent_failure::<DeleteProjectInstanceError>(&err))?;

        tx.commit().await?;

        Ok(())
    }

    /// Starts, stops, restarts or kills an instance.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/power", method = POST)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn power_project_instance(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        action: PowerAction,
    ) -> Result<(), _> {
        auth.require::<_, _, PowerProjectInstanceError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<PowerProjectInstanceError>(project_id, instance_id)
            .await?;

        instance
            .host
            .sdk
            .power_instance(instance.id, action)
            .await
            .map_err(|err| agent_failure::<PowerProjectInstanceError>(&err))
    }

    /// Lists the databases on one of the project's instances.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_VIEW`].
    #[route("/{instance_id}/database", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn list_instance_databases(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
    ) -> Result<Vec<InstanceDatabaseInfo>, _> {
        auth.require::<_, _, ListInstanceDatabasesError>(
            project_id,
            ProjectPermissions::DATABASE_VIEW,
        )?;

        let instance = self
            .require_instance::<ListInstanceDatabasesError>(project_id, instance_id)
            .await?;

        Ok(instance
            .host
            .sdk
            .list_databases(instance.id)
            .await
            .map_err(|err| agent_failure::<ListInstanceDatabasesError>(&err))?
            .into_iter()
            .map(|database| InstanceDatabaseInfo { database })
            .collect())
    }

    /// Creates a database on one of the project's instances. There is no limit
    /// on how many an instance may hold.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/database", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, name_invalid, agent_error}, db::failure <- [sql:*])]
    async fn create_instance_database(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        payload: CreateInstanceDatabase,
    ) -> Result<InstanceDatabaseInfo, _> {
        auth.require::<_, _, CreateInstanceDatabaseError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        if !validate_database_name(&payload.name) {
            return Err(CreateInstanceDatabaseError::DatabaseNameInvalid);
        }

        let instance = self
            .require_instance::<CreateInstanceDatabaseError>(project_id, instance_id)
            .await?;

        let database = instance
            .host
            .sdk
            .create_database(instance.id, payload.name)
            .await
            .map_err(|err| agent_failure::<CreateInstanceDatabaseError>(&err))?;

        Ok(InstanceDatabaseInfo { database })
    }

    /// Deletes a database. Users granted on it keep existing and simply lose
    /// that grant.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/database/{database_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn delete_instance_database(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteInstanceDatabaseError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<DeleteInstanceDatabaseError>(project_id, instance_id)
            .await?;

        instance
            .host
            .sdk
            .delete_database(instance.id, database_id)
            .await
            .map_err(|err| agent_failure::<DeleteInstanceDatabaseError>(&err))
    }

    /// Lists the users on one of the project's instances, with the connection
    /// string each of them uses.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_VIEW`].
    #[route("/{instance_id}/user", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn list_instance_users(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
    ) -> Result<Vec<InstanceUserInfo>, _> {
        auth.require::<_, _, ListInstanceUsersError>(
            project_id,
            ProjectPermissions::DATABASE_VIEW,
        )?;

        let instance = self
            .require_instance::<ListInstanceUsersError>(project_id, instance_id)
            .await?;

        let databases = instance
            .host
            .sdk
            .list_databases(instance.id)
            .await
            .map_err(|err| agent_failure::<ListInstanceUsersError>(&err))?;

        Ok(instance
            .host
            .sdk
            .list_users(instance.id)
            .await
            .map_err(|err| agent_failure::<ListInstanceUsersError>(&err))?
            .into_iter()
            .map(|user| user_info(&instance, user, &databases))
            .collect())
    }

    /// Creates a user, granted on as many of the instance's databases as the
    /// payload lists, each read-only or read-write.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/user", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, name_invalid, agent_error}, db::failure <- [sql:*])]
    async fn create_instance_user(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        payload: CreateInstanceUser,
    ) -> Result<InstanceUserInfo, _> {
        auth.require::<_, _, CreateInstanceUserError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        if !validate_username(&payload.username) {
            return Err(CreateInstanceUserError::DatabaseNameInvalid);
        }

        let instance = self
            .require_instance::<CreateInstanceUserError>(project_id, instance_id)
            .await?;

        let user = instance
            .host
            .sdk
            .create_user(instance.id, payload.username, payload.grants)
            .await
            .map_err(|err| agent_failure::<CreateInstanceUserError>(&err))?;

        let databases = instance
            .host
            .sdk
            .list_databases(instance.id)
            .await
            .map_err(|err| agent_failure::<CreateInstanceUserError>(&err))?;

        Ok(user_info(&instance, user, &databases))
    }

    /// Replaces a user's database grants. Databases left out of the payload
    /// lose their access.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/user/{user_id}/grants", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, user_not_found, agent_error}, db::failure <- [sql:*])]
    async fn set_instance_user_grants(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        user_id: Uuid,
        payload: SetInstanceUserGrants,
    ) -> Result<InstanceUserInfo, _> {
        auth.require::<_, _, SetInstanceUserGrantsError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<SetInstanceUserGrantsError>(project_id, instance_id)
            .await?;

        let user = instance
            .host
            .sdk
            .set_user_grants(instance.id, user_id, payload.grants)
            .await
            .map_err(|err| agent_failure::<SetInstanceUserGrantsError>(&err))?;

        let databases = instance
            .host
            .sdk
            .list_databases(instance.id)
            .await
            .map_err(|err| agent_failure::<SetInstanceUserGrantsError>(&err))?;

        Ok(user_info(&instance, user, &databases))
    }

    /// Deletes a user.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/user/{user_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn delete_instance_user(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteInstanceUserError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<DeleteInstanceUserError>(project_id, instance_id)
            .await?;

        instance
            .host
            .sdk
            .delete_user(instance.id, user_id)
            .await
            .map_err(|err| agent_failure::<DeleteInstanceUserError>(&err))
    }

    /// Replaces a user's password with a freshly generated one.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{instance_id}/user/{user_id}/rotate", method = POST)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn rotate_instance_user_password(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        user_id: Uuid,
    ) -> Result<InstanceUserInfo, _> {
        auth.require::<_, _, RotateInstanceUserPasswordError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<RotateInstanceUserPasswordError>(project_id, instance_id)
            .await?;

        instance
            .host
            .sdk
            .rotate_user_password(instance.id, user_id)
            .await
            .map_err(|err| agent_failure::<RotateInstanceUserPasswordError>(&err))?;

        let user = instance
            .host
            .sdk
            .get_user(instance.id, user_id)
            .await
            .map_err(|err| agent_failure::<RotateInstanceUserPasswordError>(&err))?;

        let databases = instance
            .host
            .sdk
            .list_databases(instance.id)
            .await
            .map_err(|err| agent_failure::<RotateInstanceUserPasswordError>(&err))?;

        Ok(user_info(&instance, user, &databases))
    }
}
