use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::deploy::DeployConfig;
use crate::db::group::node_in_group;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::db::server::provision::ServerProvision;
use crate::service::admin::deploy::deploy_admin_service_error::{
    CreateDeployConfigError, DeleteDeployConfigError, DeployServerError, ListDeployConfigsError,
    UpdateDeployConfigError,
};
use crate::service::error_deploy_name_invalid::FromDeployNameInvalid;
use crate::service::error_deploy_resources_invalid::FromDeployResourcesInvalid;
use crate::service::template::error_template_corrupted::FromTemplateCorrupted;
use crate::service::template::error_template_input_invalid::FromTemplateInputInvalid;
use crate::service::template::error_template_not_found::FromTemplateNotFound;
use crate::service::template::error_template_unavailable::FromTemplateUnavailable;
use crate::service::template::*;
use crate::service::*;
use crate::templates::{TemplateError, ThinTemplateError};
use daemon_common::service::server::ServerResourcePayload;
use redis::RedisError;
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use sqlx::{query, query_scalar};
use std::collections::HashMap;
use tokio::sync::Mutex;
use uuid::Uuid;
use zelus::service;

define_path_variable!(config_id "The deploy config identifier");

const MAX_DEPLOY_CONFIG_NAME_LENGTH: usize = 64;

static DEPLOY_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct DeployConfigPayload {
    pub(crate) name: String,
    pub(crate) group: String,
    pub(crate) template: String,
    pub(crate) variables: HashMap<String, String>,
    pub(crate) cpu: f32,
    pub(crate) ram: u32,
    pub(crate) swap: u32,
    pub(crate) disk: Option<u64>,
    pub(crate) internet_access: bool,
    pub(crate) backup_limit: Option<u32>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct DeployedServer {
    pub(crate) id: ServerId,
    pub(crate) node: Uuid,
}

#[service(path = "/admin/deploy", tag = "deploy", no_sdk)]
pub(crate) impl DeployAdminService for Backend {
    /// Lists all deploy configs.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/configs", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_deploy_configs(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<DeployConfig>, _> {
        auth.require::<_, _, ListDeployConfigsError>((), ManagementPermissions::SERVER_MANAGE)?;

        Ok(self.load_deploy_configs(None).await?)
    }

    /// Creates a deploy config: a template with its variables and the resources a server gets,
    /// assigned to the group whose nodes servers are deployed to. The variables are validated
    /// against the template.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/configs", method = PUT)]
    #[error(deploy::{name_invalid, name_taken <- [sql:unique], resources_invalid}, group::not_found <- [sql:foreign_key],
        template::{not_found, unavailable, corrupted, input_invalid}, cache::failure <- [redis:*],
        auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn create_deploy_config(
        &self,
        #[special] auth: Authentication,
        config: DeployConfigPayload,
    ) -> Result<i32, _> {
        auth.require::<_, _, CreateDeployConfigError>((), ManagementPermissions::SERVER_MANAGE)?;

        let config = self
            .validate_deploy_config::<CreateDeployConfigError>(config)
            .await?;

        Ok(query_scalar!(
            r#"INSERT INTO deploy_configs (name, group_name, template, variables, cpu, ram, swap, disk, internet_access, backup_limit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id"#,
            config.name,
            config.group,
            config.template,
            Json(&config.variables) as _,
            config.cpu,
            config.ram.cast_signed(),
            config.swap.cast_signed(),
            config.disk.map(u64::cast_signed),
            config.internet_access,
            config.backup_limit.map(u32::cast_signed),
        )
        .fetch_one(&*self.database)
        .await?)
    }

    /// Replaces a deploy config. Servers deployed from it earlier are not changed.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/configs/{config_id}", method = PUT)]
    #[error(deploy::{config_not_found, name_invalid, name_taken <- [sql:unique], resources_invalid}, group::not_found <- [sql:foreign_key],
        template::{not_found, unavailable, corrupted, input_invalid}, cache::failure <- [redis:*],
        auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn update_deploy_config(
        &self,
        #[special] auth: Authentication,
        config_id: i32,
        config: DeployConfigPayload,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateDeployConfigError>((), ManagementPermissions::SERVER_MANAGE)?;

        let config = self
            .validate_deploy_config::<UpdateDeployConfigError>(config)
            .await?;

        let updated = query!(
            r#"UPDATE deploy_configs SET name = $2, group_name = $3, template = $4, variables = $5, cpu = $6,
                      ram = $7, swap = $8, disk = $9, internet_access = $10, backup_limit = $11
               WHERE id = $1"#,
            config_id,
            config.name,
            config.group,
            config.template,
            Json(&config.variables) as _,
            config.cpu,
            config.ram.cast_signed(),
            config.swap.cast_signed(),
            config.disk.map(u64::cast_signed),
            config.internet_access,
            config.backup_limit.map(u32::cast_signed),
        )
        .execute(&*self.database)
        .await?
        .rows_affected();

        if updated == 0 {
            return Err(UpdateDeployConfigError::DeployConfigNotFound);
        }
        Ok(())
    }

    /// Deletes a deploy config. Servers deployed from it are not changed.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/configs/{config_id}", method = DELETE)]
    #[error(deploy::config_not_found, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn delete_deploy_config(
        &self,
        #[special] auth: Authentication,
        config_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteDeployConfigError>((), ManagementPermissions::SERVER_MANAGE)?;

        let deleted = query!("DELETE FROM deploy_configs WHERE id = $1", config_id)
            .execute(&*self.database)
            .await?
            .rows_affected();

        if deleted == 0 {
            return Err(DeleteDeployConfigError::DeployConfigNotFound);
        }
        Ok(())
    }

    /// Deploys a server from a deploy config into a project.
    ///
    /// `node` is optional. When it is set, the server is deployed on that node, which has to be
    /// assigned to the config's group. Otherwise the node is picked from the nodes assigned to
    /// the config's group: nodes in maintenance or without metrics are skipped, and of the nodes
    /// whose capacity still fits the config the one with the most free cpu and memory wins. A node's capacity is its hardware, capped by
    /// the daemon's server limit, times its overallocation; it is compared against the limits of
    /// the servers already on it. Ports are allocated from the node's free port ranges and the
    /// server is placed in the config's group.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_DEPLOY`].
    #[route("/configs/{config_id}/deploy", method = POST)]
    #[error(deploy::{config_not_found, no_capacity}, project::not_found, server::storage_not_found, node::{not_found, failure},
        group::not_on_node,
        port::{invalid, not_allocated},
        template::{not_found, unavailable, corrupted, port_definition_unknown, input_invalid}, cache::failure <- [redis:*],
        auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn deploy_server(
        &self,
        #[special] auth: Authentication,
        config_id: i32,
        project: ProjectId,
        name: String,
        node: Option<Uuid>,
    ) -> Result<DeployedServer, _> {
        auth.require::<_, _, DeployServerError>((), ManagementPermissions::SERVER_DEPLOY)?;

        let project_exists = query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM projects WHERE id = $1) AS "exists!""#,
            &project
        )
        .fetch_one(&*self.database)
        .await?;
        if !project_exists {
            return Err(DeployServerError::ProjectNotFound);
        }

        let config = self
            .load_deploy_configs(Some(config_id))
            .await?
            .pop()
            .ok_or(DeployServerError::DeployConfigNotFound)?;

        if let Some(node) = node {
            if self.nodes.read().await.get(&node).is_none() {
                return Err(DeployServerError::NodeNotFound);
            }
            if !node_in_group(&*self.database, node, &config.group).await? {
                return Err(DeployServerError::GroupNotOnNode);
            }
        }

        let template = self
            .templates
            .read()
            .await
            .get(&config.template)
            .cloned()
            .ok_or(DeployServerError::TemplateNotFound)?;

        let definitions = template
            .default_ports()
            .await
            .map_err(ThinTemplateError::into::<DeployServerError>)?;

        let _guard = DEPLOY_LOCK.lock().await;

        let placement = self
            .place_deploy(&config, &definitions, node)
            .await?
            .ok_or(DeployServerError::DeployNoCapacity)?;
        let deployed_node = placement.node.id;

        let id = self
            .provision_server::<DeployServerError>(ServerProvision {
                name,
                node: placement.node,
                project,
                template,
                storage: placement.storage,
                resource: ServerResourcePayload {
                    cpu: Some(config.cpu),
                    ram: Some(config.ram),
                    swap: Some(config.swap),
                    disk: config.disk,
                },
                ports: placement.ports,
                variables: config.variables,
                internet_access: config.internet_access,
                backup_limit: config.backup_limit,
                group: Some(config.group),
            })
            .await?;

        Ok(DeployedServer {
            id,
            node: deployed_node,
        })
    }
}

impl Backend {
    async fn validate_deploy_config<E>(
        &self,
        mut config: DeployConfigPayload,
    ) -> Result<DeployConfigPayload, E>
    where
        E: FromDeployNameInvalid
            + FromDeployResourcesInvalid
            + FromTemplateNotFound
            + FromTemplateInputInvalid
            + FromTemplateCorrupted
            + FromTemplateUnavailable
            + From<RedisError>,
    {
        config.name = config.name.trim().to_owned();
        if config.name.is_empty() || config.name.chars().count() > MAX_DEPLOY_CONFIG_NAME_LENGTH {
            return Err(<E as FromDeployNameInvalid>::from());
        }

        if !(config.cpu.is_finite() && config.cpu > 0.0)
            || config.ram == 0
            || config.disk == Some(0)
        {
            return Err(<E as FromDeployResourcesInvalid>::from());
        }

        let template = self
            .templates
            .read()
            .await
            .get(&config.template)
            .cloned()
            .ok_or_else(<E as FromTemplateNotFound>::from)?;

        let default_extra = template
            .default_extra(self.cache.clone())
            .await
            .map_err(ThinTemplateError::into::<E>)?;
        if template
            .variables_to_extra_validated(
                self.cache.clone(),
                default_extra,
                config.variables.clone(),
            )
            .await
            .map_err(TemplateError::into::<E>)?
            .is_none()
        {
            return Err(<E as FromTemplateInputInvalid>::from());
        }

        Ok(config)
    }
}
