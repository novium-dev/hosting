use std::time::Instant;

use indexmap::IndexSet;
use rand::TryRng as _;
use tracing::error;

use serde::Serialize;
use uuid::Uuid;
use zelus::service;

use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::node::NodePortAllocation;
use crate::service::admin::node::node_admin_service_error::{
    CreateNodeError, ListNodesError, UpdateNodeError,
};
use crate::service::error_os_failure::FromOsFailure;
use crate::service::*;

define_path_variable!(node_id "The node identifier");

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct NodeInfo {
    pub(crate) id: Uuid,
    pub(crate) display: String,
    pub(crate) default_bind: String,
    pub(crate) default_host: String,
    pub(crate) server_storages: IndexSet<String>,
    pub(crate) backup_storages: IndexSet<String>,
    pub(crate) ports: Vec<NodePortAllocation>,
}

#[service(path = "/admin/node", tag = "node", no_sdk)]
pub(crate) impl NodeAdminService for Backend {
    /// Creates a new node registration code.
    ///
    /// # Permissions
    /// Requires [`ManagementPermission::NODES_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, os::failure, db::failure <- [sql:*], cache::failure <- [redis:*])]
    async fn create_node(&self, #[special] auth: Authentication) -> Result<String, _> {
        auth.require::<_, CreateNodeError>((), ManagementPermissions::NODES_MANAGE)?;

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
    #[error(node::not_found, auth::{permission_denied, unreachable}, os::failure, db::failure <- [sql:*], cache::failure <- [redis:*])]
    async fn update_node(
        &self,
        #[special] auth: Authentication,
        #[no_schema] node_id: Uuid,
    ) -> Result<String, _> {
        auth.require::<_, UpdateNodeError>((), ManagementPermissions::NODES_MANAGE)?;

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
    #[error(auth::{permission_denied, unreachable}, os::failure, db::failure <- [sql:*], cache::failure <- [redis:*])]
    async fn list_nodes(&self, #[special] auth: Authentication) -> Result<Vec<NodeInfo>, _> {
        auth.require::<_, ListNodesError>((), ManagementPermissions::NODES_VIEW)?;
        Ok(self
            .nodes
            .read()
            .await
            .values()
            .map(|node| NodeInfo {
                id: node.id,
                display: node.display.clone(),
                default_bind: node.default_bind.clone(),
                default_host: node.default_host.clone(),
                server_storages: node.server_storages.keys().cloned().collect(),
                backup_storages: node.backup_storages.keys().cloned().collect(),
                ports: node.ports.clone(),
            })
            .collect())
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
