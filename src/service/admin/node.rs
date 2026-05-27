use std::time::Instant;

use indexmap::IndexSet;
use rand::TryRng as _;
use tracing::error;

use serde::Serialize;
use sqlx::{Connection as _, query, query_scalar};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use zelus::service;

use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::node::NodePortAllocation;
use crate::db::server::ports::NetworkProtocol;
use crate::service::admin::node::node_admin_service_error::{
    AddNodePortError, AvailablePortsError, CreateNodeError, DeleteNodePortError, ListNodesError,
    MetricsNodeError, UpdateMaintenanceError, UpdateNodeError,
};
use crate::service::error_os_failure::FromOsFailure;
use crate::service::*;

define_path_variable!(node_id "The node identifier");

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct NodeInfo {
    pub(crate) id: Uuid,
    pub(crate) display: String,
    pub(crate) maintenance: bool,
    pub(crate) default_bind: String,
    pub(crate) default_host: String,
    pub(crate) server_storages: IndexSet<String>,
    pub(crate) backup_storages: IndexSet<String>,
    pub(crate) ports: Vec<NodePortAllocation>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct PortRange {
    pub(crate) start: u16,
    pub(crate) end: u16,
    pub(crate) exclude: HashSet<u16>,
}

#[service(path = "/admin/node", tag = "node", no_sdk)]
pub(crate) impl NodeAdminService for Backend {
    /// Creates a new node registration code.
    ///
    /// # Permissions
    /// Requires [`ManagementPermission::NODES_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, os::failure, db::failure <- [sql:*])]
    async fn create_node(&self, #[special] auth: Authentication) -> Result<String, _> {
        auth.require::<_, _, CreateNodeError>((), ManagementPermissions::NODES_MANAGE)?;

        let code = gen_code::<CreateNodeError>()?;

        self.node_registrations
            .write()
            .await
            .insert(code.clone(), (Instant::now(), None));

        Ok(code)
    }

    /// Creates a new node registration code to update an existing node.
    ///
    /// # Permissions
    /// Requires [`ManagementPermission::NODES_MANAGE`].
    #[route("/{node_id}", method = PATCH)]
    #[error(node::not_found, auth::{permission_denied, unreachable}, os::failure, db::failure <- [sql:*])]
    async fn update_node(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
    ) -> Result<String, _> {
        auth.require::<_, _, UpdateNodeError>((), ManagementPermissions::NODES_MANAGE)?;

        if self.nodes.read().await.get(&node_id).is_none() {
            return Err(UpdateNodeError::NodeNotFound);
        }

        let code = gen_code::<UpdateNodeError>()?;

        self.node_registrations
            .write()
            .await
            .insert(code.clone(), (Instant::now(), Some(node_id)));

        Ok(code)
    }

    /// Lists all nodes.
    ///
    /// # Permissions
    /// Requires [`ManagementPermission::NODES_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, os::failure, db::failure <- [sql:*])]
    async fn list_nodes(&self, #[special] auth: Authentication) -> Result<Vec<NodeInfo>, _> {
        auth.require::<_, _, ListNodesError>((), ManagementPermissions::NODES_VIEW)?;
        Ok(self
            .nodes
            .read()
            .await
            .values()
            .map(|node| NodeInfo {
                id: node.id,
                display: node.display.clone(),
                maintenance: node.maintenance,
                default_bind: node.default_bind.clone(),
                default_host: node.default_host.clone(),
                server_storages: node.server_storages.keys().cloned().collect(),
                backup_storages: node.backup_storages.keys().cloned().collect(),
                ports: node.ports.clone(),
            })
            .collect())
    }

    /// Updates maintenance mode for a node.
    ///
    /// # Permissions
    /// Requires [`ManagementPermission::NODES_MANAGE`].
    #[route("/{node_id}/maintenance", method = PATCH)]
    #[error(node::not_found, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn update_maintenance(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
        maintenance: bool,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateMaintenanceError>((), ManagementPermissions::NODES_MANAGE)?;

        if self.nodes.read().await.get(&node_id).is_none() {
            return Err(UpdateMaintenanceError::NodeNotFound);
        }

        let mut conn = self.database.acquire().await?;
        let backend = self.clone();
        conn.transaction(|tx| {
            Box::pin(async move {
                query!(
                    "UPDATE nodes SET maintenance = $1 WHERE id = $2",
                    maintenance,
                    node_id
                )
                .execute(&mut **tx)
                .await?;

                backend.sync_nodes(tx).await?;

                Ok::<_, UpdateMaintenanceError>(())
            })
        })
        .await
    }

    #[route("/{node_id}/metrics", method = GET)]
    #[error(node::not_found, node::failure, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn metrics_node(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
    ) -> Result<daemon_common::service::resource::ResourceResponse, _> {
        use daemon_common::service::resource::resource_service_error::ResourceInfoError;

        auth.require::<_, _, MetricsNodeError>((), ManagementPermissions::NODES_VIEW)?;

        let node = self
            .nodes
            .read()
            .await
            .get(&node_id)
            .cloned()
            .ok_or(MetricsNodeError::NodeNotFound)?;

        node.resource_info().await.map_err(|err| match err {
            ResourceInfoError::Communication(_) => {
                error!("Failed to request resource info: {err:?}");
                MetricsNodeError::NodeFailure
            }
            ResourceInfoError::AuthInvalid
            | ResourceInfoError::SqlFailure
            | ResourceInfoError::Resource => {
                error!("Failed to get resource info: {err:?}");
                MetricsNodeError::NodeFailure
            }
        })
    }

    #[route("/{node_id}/ports", method = GET)]
    #[error(node::not_found, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn available_ports(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
    ) -> Result<HashMap<String, Vec<PortRange>>, _> {
        auth.require::<_, _, AvailablePortsError>((), ManagementPermissions::NODES_VIEW)?;

        let node = self
            .nodes
            .read()
            .await
            .get(&node_id)
            .cloned()
            .ok_or(AvailablePortsError::NodeNotFound)?;

        let used: HashSet<u16> = query!(
            r#"SELECT lower(server_ports.external_port) AS "external_port_start!", upper(server_ports.external_port) - 1 AS "external_port_end!"
               FROM servers
               JOIN server_ports ON server_ports.server = servers.id
               WHERE servers.node = $1"#,
            node_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .flat_map(|row| {
            (row.external_port_start..=row.external_port_end).filter_map(|port| port.try_into().ok())
        })
        .collect();

        let mut result: HashMap<String, Vec<PortRange>> = HashMap::new();
        for port in &node.ports {
            let exclude = (port.start..=port.end)
                .filter_map(|candidate| candidate.try_into().ok())
                .filter(|candidate| used.contains(candidate))
                .collect();
            result
                .entry(port.protocol.to_string())
                .or_default()
                .push(PortRange {
                    start: u16::try_from(port.start)
                        .expect("database port constraints ensure a u16 value"),
                    end: u16::try_from(port.end)
                        .expect("database port constraints ensure a u16 value"),
                    exclude,
                });
        }

        Ok(result)
    }

    #[route("/{node_id}/ports", method = PUT)]
    #[error(node::not_found, port::invalid, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn add_node_port(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
        start: u16,
        end: u16,
        protocol: NetworkProtocol,
    ) -> Result<i32, _> {
        auth.require::<_, _, AddNodePortError>((), ManagementPermissions::NODES_MANAGE)?;

        if start > end {
            return Err(AddNodePortError::PortInvalid);
        }

        if self.nodes.read().await.get(&node_id).is_none() {
            return Err(AddNodePortError::NodeNotFound);
        }

        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| {
            Box::pin(async move {
                let id = query!(
                    r#"INSERT INTO node_ports (node, protocol, start, "end") VALUES ($1, $2, $3, $4) RETURNING id"#,
                    node_id,
                    protocol as NetworkProtocol,
                    i32::from(start),
                    i32::from(end),
                )
                .fetch_one(&mut **tx)
                .await?
                .id;

                Ok::<_, AddNodePortError>(id)
            })
        })
        .await
    }

    #[route("/{node_id}/ports/{port_id}", method = DELETE)]
    #[error(node::not_found, port::in_use, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn delete_node_port(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
        port_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteNodePortError>((), ManagementPermissions::NODES_MANAGE)?;

        if self.nodes.read().await.get(&node_id).is_none() {
            return Err(DeleteNodePortError::NodeNotFound);
        }

        let mut conn = self.database.acquire().await?;
        let backend = self.clone();
        conn.transaction(|tx| {
            Box::pin(async move {
                let Some(port) = query!(
                    r#"SELECT protocol AS "protocol: NetworkProtocol", start, "end" FROM node_ports WHERE id = $1 AND node = $2 FOR UPDATE"#,
                    port_id,
                    node_id,
                )
                .fetch_optional(&mut **tx)
                .await?
                else {
                    return Ok::<_, DeleteNodePortError>(());
                };

                let in_use = query_scalar!(
                    r#"SELECT (COUNT(*) > 0) AS "exists!"
                       FROM server_ports
                       JOIN servers ON server_ports.server = servers.id
                       WHERE servers.node = $1
                       AND server_ports.protocol = $2
                       AND server_ports.external_port && int4range($3, $4, '[]')"#,
                    node_id,
                    port.protocol as NetworkProtocol,
                    port.start,
                    port.end,
                )
                .fetch_one(&mut **tx)
                .await?;

                if in_use {
                    return Err(DeleteNodePortError::PortInUse);
                }

                query!(
                    "DELETE FROM node_ports WHERE id = $1 AND node = $2",
                    port_id,
                    node_id,
                )
                .execute(&mut **tx)
                .await?;

                backend.sync_nodes(tx).await?;

                Ok::<_, DeleteNodePortError>(())
            })
        })
        .await
    }
}

fn gen_code<E: FromOsFailure>() -> Result<String, E> {
    let mut data = [0u8; 8];
    rand::rng()
        .try_fill_bytes(&mut data)
        .inspect_err(|err| error!("Unable to generate random bytes: {err:?}"))
        .map_err(|_err| <E as FromOsFailure>::from())?;
    Ok(format!(
        "{}-{}-{}-{}",
        hex::encode(&data[0..2]),
        hex::encode(&data[2..4]),
        hex::encode(&data[4..6]),
        hex::encode(&data[6..8])
    ))
}
