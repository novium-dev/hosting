use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::project::ProjectId;
use crate::db::region::RegionId;
use crate::service::admin::database::database_admin_service_error::{
    CreateDatabaseHostError, DeleteDatabaseHostError, DeleteDatabaseInstanceError,
    ListDatabaseHostsError, ListDatabaseInstancesError, UpdateDatabaseHostError,
    UpdateDatabaseInstanceError,
};
use crate::service::error_database_agent_error::FromDatabaseAgentError;
use crate::service::*;
use core::str::FromStr as _;
use database_agent_common::service::instance::InstanceService as _;
use database_agent_common::types::{ApiInstance, DatabaseType, StoredInstanceUpdate};
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query, query_scalar};
use std::collections::HashMap;
use url::Url;
use uuid::Uuid;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct DatabaseHostInfo {
    pub(crate) id: Uuid,
    pub(crate) display: String,
    pub(crate) region: RegionId,
    pub(crate) url: String,
    pub(crate) public_host: String,
    pub(crate) maintenance: bool,
    pub(crate) ports: HashMap<DatabaseType, u16>,
    pub(crate) instance_count: i64,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateDatabaseHost {
    pub(crate) display: String,
    pub(crate) region: RegionId,
    pub(crate) url: Url,
    pub(crate) token: String,
    pub(crate) public_host: String,
    #[serde(default)]
    pub(crate) ports: HashMap<DatabaseType, u16>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct UpdateDatabaseHost {
    #[serde(default)]
    pub(crate) display: Option<String>,
    #[serde(default)]
    pub(crate) region: Option<RegionId>,
    #[serde(default)]
    pub(crate) url: Option<Url>,
    #[serde(default)]
    pub(crate) token: Option<String>,
    #[serde(default)]
    pub(crate) public_host: Option<String>,
    #[serde(default)]
    pub(crate) maintenance: Option<bool>,
    #[serde(default)]
    pub(crate) ports: Option<HashMap<DatabaseType, u16>>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct DatabaseInstanceInfo {
    pub(crate) id: Uuid,
    pub(crate) host: Uuid,
    #[serde(rename = "type")]
    pub(crate) kind: DatabaseType,
    pub(crate) display: String,
    pub(crate) project: ProjectId,
    pub(crate) project_slug: String,
    pub(crate) created: chrono::DateTime<chrono::Utc>,
    pub(crate) remote: Option<ApiInstance>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct CreatedId {
    pub(crate) id: Uuid,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct UpdateDatabaseInstance {
    #[serde(default)]
    pub(crate) display: Option<String>,
    #[serde(default)]
    pub(crate) memory: Option<i64>,
    #[serde(default)]
    pub(crate) swap: Option<i64>,
    #[serde(default)]
    pub(crate) disk: Option<i64>,
    #[serde(default)]
    pub(crate) cpu: Option<i64>,
    #[serde(default)]
    pub(crate) suspended: Option<bool>,
}

fn agent_failure<E: FromDatabaseAgentError>(error: &impl core::fmt::Debug) -> E {
    tracing::error!("The database agent returned an error: {error:?}");
    <E as FromDatabaseAgentError>::from()
}

impl Backend {
    async fn reload_database_hosts(&self) -> Result<(), sqlx::Error> {
        let backend = self.clone();
        self.database
            .acquire()
            .await?
            .transaction(|tx| Box::pin(async move { backend.sync_database_hosts(tx).await }))
            .await
    }
}

#[service(path = "/admin/database", tag = "database", no_sdk)]
pub(crate) impl DatabaseAdminService for Backend {
    /// Lists every registered database host.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DATABASE_HOSTS_VIEW`].
    #[route("/host", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_database_hosts(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<DatabaseHostInfo>, _> {
        auth.require::<_, _, ListDatabaseHostsError>(
            (),
            ManagementPermissions::DATABASE_HOSTS_VIEW,
        )?;

        let rows = query!(
            r#"SELECT database_hosts.id, database_hosts.display,
                   database_hosts.region AS "region: RegionId", database_hosts.url,
                   database_hosts.public_host,
                   database_hosts.maintenance AS "maintenance: bool",
                   (SELECT COUNT(*) FROM database_instances
                    WHERE database_instances.host = database_hosts.id) AS "instance_count!"
               FROM database_hosts
               ORDER BY database_hosts.display"#
        )
        .fetch_all(&*self.database)
        .await?;

        let mut hosts = Vec::with_capacity(rows.len());
        for row in rows {
            let ports = query!(
                r#"SELECT type, port FROM database_host_ports WHERE host = $1"#,
                row.id
            )
            .fetch_all(&*self.database)
            .await?
            .into_iter()
            .filter_map(|port| {
                Some((
                    DatabaseType::from_str(&port.r#type).ok()?,
                    u16::try_from(port.port).ok()?,
                ))
            })
            .collect();

            hosts.push(DatabaseHostInfo {
                id: row.id,
                display: row.display,
                region: row.region,
                url: row.url,
                public_host: row.public_host,
                maintenance: row.maintenance,
                ports,
                instance_count: row.instance_count,
            });
        }

        Ok(hosts)
    }

    /// Registers a new database host.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DATABASE_HOSTS_MANAGE`].
    #[route("/host", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, region::not_found <- [sql:not_found],
        db::failure <- [sql:*])]
    async fn create_database_host(
        &self,
        #[special] auth: Authentication,
        payload: CreateDatabaseHost,
    ) -> Result<CreatedId, _> {
        auth.require::<_, _, CreateDatabaseHostError>(
            (),
            ManagementPermissions::DATABASE_HOSTS_MANAGE,
        )?;

        query!(
            r#"SELECT id AS "id: RegionId" FROM regions WHERE id = $1"#,
            &payload.region
        )
        .fetch_one(&*self.database)
        .await?;

        let id = Uuid::new_v4();

        query!(
            "INSERT INTO database_hosts (id, display, region, url, token, public_host)
             VALUES ($1, $2, $3, $4, $5, $6)",
            id,
            payload.display,
            &payload.region,
            payload.url.to_string(),
            payload.token,
            payload.public_host
        )
        .execute(&*self.database)
        .await?;

        for (kind, port) in payload.ports {
            query!(
                "INSERT INTO database_host_ports (host, type, port) VALUES ($1, $2, $3)",
                id,
                kind.as_str(),
                i32::from(port)
            )
            .execute(&*self.database)
            .await?;
        }

        self.reload_database_hosts().await?;

        Ok(CreatedId { id })
    }

    /// Updates a registered database host.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DATABASE_HOSTS_MANAGE`].
    #[route("/host/{host_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, database::host_not_found <- [sql:not_found],
        db::failure <- [sql:*])]
    async fn update_database_host(
        &self,
        #[special] auth: Authentication,
        host_id: Uuid,
        payload: UpdateDatabaseHost,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateDatabaseHostError>(
            (),
            ManagementPermissions::DATABASE_HOSTS_MANAGE,
        )?;

        query!(
            "UPDATE database_hosts SET
                 display = COALESCE($2, display),
                 region = COALESCE($3, region),
                 url = COALESCE($4, url),
                 token = COALESCE($5, token),
                 public_host = COALESCE($6, public_host),
                 maintenance = COALESCE($7, maintenance)
             WHERE id = $1",
            host_id,
            payload.display,
            payload.region.as_ref().map(ToString::to_string),
            payload.url.map(|url| url.to_string()),
            payload.token,
            payload.public_host,
            payload.maintenance
        )
        .execute(&*self.database)
        .await?;

        if let Some(ports) = payload.ports {
            query!("DELETE FROM database_host_ports WHERE host = $1", host_id)
                .execute(&*self.database)
                .await?;

            for (kind, port) in ports {
                query!(
                    "INSERT INTO database_host_ports (host, type, port) VALUES ($1, $2, $3)",
                    host_id,
                    kind.as_str(),
                    i32::from(port)
                )
                .execute(&*self.database)
                .await?;
            }
        }

        self.reload_database_hosts().await?;

        Ok(())
    }

    /// Unregisters a database host that carries no instances.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DATABASE_HOSTS_MANAGE`].
    #[route("/host/{host_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, database::{host_not_found, host_not_empty},
        db::failure <- [sql:*])]
    async fn delete_database_host(
        &self,
        #[special] auth: Authentication,
        host_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteDatabaseHostError>(
            (),
            ManagementPermissions::DATABASE_HOSTS_MANAGE,
        )?;

        let instances = query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM database_instances WHERE host = $1"#,
            host_id
        )
        .fetch_one(&*self.database)
        .await?;
        if instances > 0 {
            return Err(DeleteDatabaseHostError::DatabaseHostNotEmpty);
        }

        let deleted = query!("DELETE FROM database_hosts WHERE id = $1", host_id)
            .execute(&*self.database)
            .await?;
        if deleted.rows_affected() == 0 {
            return Err(DeleteDatabaseHostError::DatabaseHostNotFound);
        }

        self.reload_database_hosts().await?;

        Ok(())
    }

    /// Lists the database instances of a host, enriched with their live state.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DATABASE_HOSTS_VIEW`].
    #[route("/host/{host_id}/instance", method = GET)]
    #[error(auth::{permission_denied, unreachable}, database::host_not_found,
        db::failure <- [sql:*])]
    async fn list_database_instances(
        &self,
        #[special] auth: Authentication,
        host_id: Uuid,
    ) -> Result<Vec<DatabaseInstanceInfo>, _> {
        auth.require::<_, _, ListDatabaseInstancesError>(
            (),
            ManagementPermissions::DATABASE_HOSTS_VIEW,
        )?;

        let host = self
            .database_host(host_id)
            .await
            .ok_or(ListDatabaseInstancesError::DatabaseHostNotFound)?;

        let remote = host
            .sdk
            .list_instances()
            .await
            .inspect_err(|err| tracing::warn!("Unable to list the remote instances: {err:?}"))
            .unwrap_or_default();

        Ok(query!(
            r#"SELECT database_instances.id, database_instances.host,
                   database_instances.type AS kind, database_instances.display,
                   database_instances.project AS "project: ProjectId",
                   projects.slug AS project_slug, database_instances.created
               FROM database_instances
               JOIN projects ON projects.id = database_instances.project
               WHERE database_instances.host = $1
               ORDER BY database_instances.display"#,
            host_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .filter_map(|row| {
            Some(DatabaseInstanceInfo {
                kind: DatabaseType::from_str(&row.kind).ok()?,
                remote: remote
                    .iter()
                    .find(|instance| instance.data.uuid == row.id)
                    .cloned(),
                id: row.id,
                host: row.host,
                display: row.display,
                project: row.project,
                project_slug: row.project_slug,
                created: row.created,
            })
        })
        .collect())
    }

    /// Renames a database instance and changes its resource limits.
    ///
    /// Projects own their instances but cannot resize or rename them; this is
    /// where that happens.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DATABASE_HOSTS_MANAGE`].
    #[route("/host/{host_id}/instance/{instance_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable},
        database::{host_not_found, instance_not_found, agent_error}, db::failure <- [sql:*])]
    async fn update_database_instance(
        &self,
        #[special] auth: Authentication,
        host_id: Uuid,
        instance_id: Uuid,
        payload: UpdateDatabaseInstance,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateDatabaseInstanceError>(
            (),
            ManagementPermissions::DATABASE_HOSTS_MANAGE,
        )?;

        let host = self
            .database_host(host_id)
            .await
            .ok_or(UpdateDatabaseInstanceError::DatabaseHostNotFound)?;

        if let Some(display) = payload.display {
            let updated = query!(
                "UPDATE database_instances SET display = $1 WHERE id = $2 AND host = $3",
                display,
                instance_id,
                host_id
            )
            .execute(&*self.database)
            .await?;
            if updated.rows_affected() == 0 {
                return Err(UpdateDatabaseInstanceError::DatabaseInstanceNotFound);
            }
        }

        let update = StoredInstanceUpdate {
            memory: payload.memory,
            swap: payload.swap,
            disk: payload.disk,
            cpu: payload.cpu,
            suspended: payload.suspended,
            ..Default::default()
        };

        host.sdk
            .update_instance(instance_id, update)
            .await
            .map_err(|err| agent_failure::<UpdateDatabaseInstanceError>(&err))?;

        Ok(())
    }

    /// Deletes a database instance and everything stored in it.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DATABASE_HOSTS_MANAGE`].
    #[route("/host/{host_id}/instance/{instance_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable},
        database::{host_not_found, instance_not_found, agent_error},
        db::failure <- [sql:*])]
    async fn delete_database_instance(
        &self,
        #[special] auth: Authentication,
        host_id: Uuid,
        instance_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteDatabaseInstanceError>(
            (),
            ManagementPermissions::DATABASE_HOSTS_MANAGE,
        )?;

        let host = self
            .database_host(host_id)
            .await
            .ok_or(DeleteDatabaseInstanceError::DatabaseHostNotFound)?;

        host.sdk
            .delete_instance(instance_id)
            .await
            .map_err(|err| agent_failure::<DeleteDatabaseInstanceError>(&err))?;

        let deleted = query!(
            "DELETE FROM database_instances WHERE id = $1 AND host = $2",
            instance_id,
            host_id
        )
        .execute(&*self.database)
        .await?;
        if deleted.rows_affected() == 0 {
            return Err(DeleteDatabaseInstanceError::DatabaseInstanceNotFound);
        }

        Ok(())
    }
}
