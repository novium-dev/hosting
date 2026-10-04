use std::time::Instant;

use rand::TryRng as _;
use tracing::error;

use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query, query_scalar};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use zelus::service;

use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::group::GroupLimits;
use crate::db::node::{NodePortAllocation, replace_storages, used_ports};
use crate::db::server::ports::NetworkProtocol;
use crate::service::admin::node::node_admin_service_error::{
    AddNodePortError, AvailablePortsError, CreateNodeError, DeleteNodeError, DeleteNodePortError,
    ExtendNodeRegistrationError, ListNodeGroupsError, ListNodeRegistrationsError, ListNodesError,
    MetricsNodeError, UpdateMaintenanceError, UpdateNodeError, UpdateNodeOverallocationError,
    UpdateNodeRegistrationError,
};
use crate::service::error_os_failure::FromOsFailure;
use crate::service::internal::REGISTRATION_TIMEOUT;
use crate::service::*;
use crate::{Backend, NodeRegistration};
use daemon_common::node::{
    BackendNodeConfig, BackupStorage, HostAndPort, ServerStorage, SetupNodeConfig,
};
use url::{Host, Url};
use utoipa::ToSchema;

define_path_variable!(node_id "The node identifier");
define_path_variable!(code "The node registration code");

const MAX_OVERALLOCATION: u16 = 1000;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct NodeInfo {
    pub(crate) id: Uuid,
    pub(crate) display: String,
    pub(crate) maintenance: bool,
    pub(crate) default_bind: String,
    pub(crate) default_host: String,
    pub(crate) ssh_host: Option<String>,
    pub(crate) ssh_port: Option<u16>,
    pub(crate) server_storages: Vec<String>,
    pub(crate) backup_storages: Vec<String>,
    pub(crate) ports: Vec<NodePortAllocation>,
    pub(crate) server_count: i64,
    pub(crate) overallocation: u16,
    pub(crate) groups: Vec<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct NodeGroupInfo {
    pub(crate) name: String,
    pub(crate) limits: GroupLimits,
    pub(crate) server_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SshEndpointRequest {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SetupNodeConfigRequest {
    pub base_url: Url,
    pub default_host: String,
    pub ssh: Option<SshEndpointRequest>,

    pub storages: HashMap<String, ServerStorage>,
    pub backups: HashMap<String, BackupStorage>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct NodeRegistrationInfo {
    pub(crate) code: String,
    pub(crate) name: String,
    pub(crate) base_url: Url,
    pub(crate) default_host: String,
    pub(crate) ssh: Option<SshEndpointRequest>,
    pub(crate) storages: HashMap<String, ServerStorage>,
    pub(crate) backups: HashMap<String, BackupStorage>,
    pub(crate) expires_in: u64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct PortRange {
    pub(crate) start: u16,
    pub(crate) end: u16,
    pub(crate) exclude: HashSet<u16>,
}

#[service(path = "/admin/node", tag = "node", no_sdk)]
pub(crate) impl NodeAdminService for Backend {
    /// Creates a new node registration code for the given intended [`NodeConfig`].
    ///
    /// The daemon pulls the config during setup (`GET /internal/daemon/config`)
    /// using the returned code and registers itself against it.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, os::failure, node::invalid_host, db::failure <- [sql:*])]
    async fn create_node(
        &self,
        #[special] auth: Authentication,
        name: String,
        config: SetupNodeConfigRequest,
    ) -> Result<String, _> {
        auth.require::<_, _, CreateNodeError>((), ManagementPermissions::NODES_MANAGE)?;

        let code = gen_code::<CreateNodeError>()?;

        let origins = vec![self.config.public_url.to_string()];

        let ssh = config
            .ssh
            .map(|endpoint| {
                Ok::<_, CreateNodeError>(HostAndPort {
                    host: Host::parse(&endpoint.host)
                        .map_err(|_err| CreateNodeError::NodeInvalidHost)?,
                    port: endpoint.port,
                })
            })
            .transpose()?;

        let final_config = SetupNodeConfig {
            base_url: config.base_url,
            ssh,
            origins,
            storages: config.storages,
            backups: config.backups,
        };

        let registration = NodeRegistration {
            time: Instant::now(),
            name,
            default_host: config.default_host,
            config: final_config,
        };

        self.node_registrations
            .write()
            .await
            .insert(code.clone(), registration);

        Ok(code)
    }

    /// Pulls the current [`NodeConfig`] from a running node over mTLS and
    /// reconciles it into the backend's stored config.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{node_id}", method = PATCH)]
    #[error(node::{not_found, failure}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn update_node(&self, #[special] auth: Authentication, node_id: Uuid) -> Result<(), _> {
        auth.require::<_, _, UpdateNodeError>((), ManagementPermissions::NODES_MANAGE)?;

        let node = self
            .nodes
            .read()
            .await
            .get(&node_id)
            .cloned()
            .ok_or(UpdateNodeError::NodeNotFound)?;

        let BackendNodeConfig {
            base_url,
            storages,
            backups,
            ssh_port,
        } = node.config().await.map_err(|err| {
            error!("Failed to pull config from node {node_id}: {err:?}");
            UpdateNodeError::NodeFailure
        })?;

        let ssh_port: Option<i32> = ssh_port.map(i32::from);

        let mut conn = self.database.acquire().await?;
        let backend = self.clone();
        conn.transaction(|tx| {
            Box::pin(async move {
                query!(
                    "UPDATE nodes SET url = $1, ssh_port = $2 WHERE id = $3",
                    base_url.as_str(),
                    ssh_port,
                    node_id
                )
                .execute(&mut **tx)
                .await
                .inspect_err(|err| error!("Unable to update node config: {err:?}"))?;

                replace_storages(tx, &node_id, storages, backups).await?;

                backend.sync_nodes(tx).await?;

                Ok::<_, UpdateNodeError>(())
            })
        })
        .await
    }

    /// Lists all nodes.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, os::failure, db::failure <- [sql:*])]
    async fn list_nodes(&self, #[special] auth: Authentication) -> Result<Vec<NodeInfo>, _> {
        auth.require::<_, _, ListNodesError>((), ManagementPermissions::NODES_VIEW)?;

        let server_counts: HashMap<Uuid, i64> =
            query!(r#"SELECT node, COUNT(*) AS "count!" FROM servers GROUP BY node"#)
                .fetch_all(&*self.database)
                .await?
                .into_iter()
                .map(|row| (row.node, row.count))
                .collect();

        let mut groups: HashMap<Uuid, Vec<String>> = HashMap::new();
        for row in query!("SELECT node, group_name FROM node_groups ORDER BY group_name")
            .fetch_all(&*self.database)
            .await?
        {
            groups.entry(row.node).or_default().push(row.group_name);
        }

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
                ssh_host: node.ssh_host.clone(),
                ssh_port: node.ssh_port,
                server_storages: node.server_storages.clone(),
                backup_storages: node.backup_storages.clone(),
                ports: node.ports.clone(),
                server_count: server_counts.get(&node.id).copied().unwrap_or_default(),
                overallocation: node.overallocation,
                groups: groups.remove(&node.id).unwrap_or_default(),
            })
            .collect())
    }

    /// Lists the node registrations that are still waiting for a daemon to set itself up.
    ///
    /// Expired registrations are pruned and never returned.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
    #[route("/registrations", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_node_registrations(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<NodeRegistrationInfo>, _> {
        auth.require::<_, _, ListNodeRegistrationsError>((), ManagementPermissions::NODES_VIEW)?;

        let mut registrations = self.node_registrations.write().await;
        registrations
            .retain(|_code, registration| registration.time.elapsed() < REGISTRATION_TIMEOUT);

        Ok(registrations
            .iter()
            .map(|(code, registration)| NodeRegistrationInfo {
                code: code.clone(),
                name: registration.name.clone(),
                base_url: registration.config.base_url.clone(),
                default_host: registration.default_host.clone(),
                ssh: registration
                    .config
                    .ssh
                    .as_ref()
                    .map(|endpoint| SshEndpointRequest {
                        host: endpoint.host.to_string(),
                        port: endpoint.port,
                    }),
                storages: registration.config.storages.clone(),
                backups: registration.config.backups.clone(),
                expires_in: REGISTRATION_TIMEOUT
                    .saturating_sub(registration.time.elapsed())
                    .as_secs(),
            })
            .collect())
    }

    /// Replaces the intended config of a node registration that has not been claimed yet.
    ///
    /// The setup code and its expiry stay untouched, so a daemon that has not
    /// pulled its config yet picks up the new one.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/registrations/{code}", method = PATCH)]
    #[error(node::{not_found, invalid_host}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn update_node_registration(
        &self,
        #[special] auth: Authentication,
        code: String,
        name: String,
        config: SetupNodeConfigRequest,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateNodeRegistrationError>((), ManagementPermissions::NODES_MANAGE)?;

        let ssh = config
            .ssh
            .map(|endpoint| {
                Ok::<_, UpdateNodeRegistrationError>(HostAndPort {
                    host: Host::parse(&endpoint.host)
                        .map_err(|_err| UpdateNodeRegistrationError::NodeInvalidHost)?,
                    port: endpoint.port,
                })
            })
            .transpose()?;

        self.node_registrations
            .write()
            .await
            .get_mut(&code)
            .filter(|registration| registration.time.elapsed() < REGISTRATION_TIMEOUT)
            .map(|registration| {
                registration.name = name;
                registration.default_host = config.default_host;
                registration.config.base_url = config.base_url;
                registration.config.ssh = ssh;
                registration.config.storages = config.storages;
                registration.config.backups = config.backups;
            })
            .ok_or(UpdateNodeRegistrationError::NodeNotFound)
    }

    /// Restarts the expiry countdown of a node registration that has not been
    /// claimed yet, so the same setup code stays usable.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/registrations/{code}/extend", method = POST)]
    #[error(node::not_found, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn extend_node_registration(
        &self,
        #[special] auth: Authentication,
        code: String,
    ) -> Result<(), _> {
        auth.require::<_, _, ExtendNodeRegistrationError>((), ManagementPermissions::NODES_MANAGE)?;

        self.node_registrations
            .write()
            .await
            .get_mut(&code)
            .map(|registration| {
                registration.time = Instant::now();
            })
            .ok_or(ExtendNodeRegistrationError::NodeNotFound)
    }

    /// Deletes a node. Nodes that still carry servers are rejected.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{node_id}", method = DELETE)]
    #[error(node::{not_found, not_empty <- [sql:foreign_key]}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn delete_node(&self, #[special] auth: Authentication, node_id: Uuid) -> Result<(), _> {
        auth.require::<_, _, DeleteNodeError>((), ManagementPermissions::NODES_MANAGE)?;

        if !self.nodes.read().await.contains_key(&node_id) {
            return Err(DeleteNodeError::NodeNotFound);
        }

        let mut conn = self.database.acquire().await?;
        let backend = self.clone();
        conn.transaction(|tx| {
            Box::pin(async move {
                let has_servers = query_scalar!(
                    r#"SELECT (COUNT(*) > 0) AS "exists!" FROM servers WHERE node = $1"#,
                    node_id
                )
                .fetch_one(&mut **tx)
                .await?;

                if has_servers {
                    return Err(DeleteNodeError::NodeNotEmpty);
                }

                query!("DELETE FROM nodes WHERE id = $1", node_id)
                    .execute(&mut **tx)
                    .await?;

                backend.sync_nodes(tx).await?;

                Ok::<_, DeleteNodeError>(())
            })
        })
        .await
    }

    /// Updates maintenance mode for a node.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
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

    /// Gets live resource usage for a node.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
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

    /// Lists the node's port ranges, keyed by port allocation id, with each range's already-used ports excluded.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
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

        let used = used_ports(&*self.database, node_id).await?;

        let mut result: HashMap<String, Vec<PortRange>> = HashMap::new();
        for port in &node.ports {
            let used_for_protocol = used.get(&port.protocol);
            let exclude = (port.start..=port.end)
                .filter_map(|candidate| u16::try_from(candidate).ok())
                .filter(|candidate| {
                    used_for_protocol.is_some_and(|ports| ports.contains(candidate))
                })
                .collect();
            result
                .entry(port.id.to_string())
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

    /// Adds a port range the node can allocate to servers.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
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
        let backend = self.clone();
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

                backend.sync_nodes(tx).await?;

                Ok::<_, AddNodePortError>(id)
            })
        })
        .await
    }

    /// Removes a port range from the node.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
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
    /// Lists the groups the node is assigned to, with the limits each group has on this node
    /// and the number of the node's servers in it.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
    #[route("/{node_id}/groups", method = GET)]
    #[error(node::not_found, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_node_groups(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
    ) -> Result<Vec<NodeGroupInfo>, _> {
        auth.require::<_, _, ListNodeGroupsError>((), ManagementPermissions::NODES_VIEW)?;

        if self.nodes.read().await.get(&node_id).is_none() {
            return Err(ListNodeGroupsError::NodeNotFound);
        }

        Ok(query!(
            r#"SELECT node_groups.group_name, node_groups.cpu, node_groups.ram, node_groups.swap,
                      COUNT(servers.id) AS "server_count!"
               FROM node_groups
               LEFT JOIN servers ON servers.node = node_groups.node AND servers.node_group = node_groups.group_name
               WHERE node_groups.node = $1
               GROUP BY node_groups.node, node_groups.group_name
               ORDER BY node_groups.group_name"#,
            node_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| NodeGroupInfo {
            name: row.group_name,
            limits: GroupLimits {
                cpu: row.cpu,
                ram: row.ram.map(i32::cast_unsigned),
                swap: row.swap.map(i32::cast_unsigned),
            },
            server_count: row.server_count,
        })
        .collect())
    }

    /// Sets how far the node may be allocated beyond its hardware when servers are deployed
    /// automatically, in percent. `120` allows 20% more cpu, memory, swap and disk to be
    /// allocated than the node has.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{node_id}/overallocation", method = PATCH)]
    #[error(node::{not_found, overallocation_invalid}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn update_node_overallocation(
        &self,
        #[special] auth: Authentication,
        node_id: Uuid,
        overallocation: u16,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateNodeOverallocationError>(
            (),
            ManagementPermissions::NODES_MANAGE,
        )?;

        if !(1..=MAX_OVERALLOCATION).contains(&overallocation) {
            return Err(UpdateNodeOverallocationError::NodeOverallocationInvalid);
        }

        if self.nodes.read().await.get(&node_id).is_none() {
            return Err(UpdateNodeOverallocationError::NodeNotFound);
        }

        let mut conn = self.database.acquire().await?;
        let backend = self.clone();
        conn.transaction(|tx| {
            Box::pin(async move {
                query!(
                    "UPDATE nodes SET overallocation = $1 WHERE id = $2",
                    i32::from(overallocation),
                    node_id
                )
                .execute(&mut **tx)
                .await?;

                backend.sync_nodes(tx).await?;

                Ok::<_, UpdateNodeOverallocationError>(())
            })
        })
        .await
    }
}

pub(crate) fn gen_code<E: FromOsFailure>() -> Result<String, E> {
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
