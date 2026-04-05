use std::time::Instant;

use rand::TryRngCore as _;
use rand::rngs::OsRng;

use tracing::error;

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zelus::service;

use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::service::admin::node::node_admin_service_error::{
    CreateNodeError, ListNodesError, UpdateNodeError,
};
use crate::service::error_os_failure::FromOsFailure;
use crate::service::*;

define_path_variable!(node_id "The node identifier");

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub struct NodeList {
    pub nodes: Vec<Uuid>,
}

#[service(path = "/admin/node", tag = "node", no_sdk)]
pub(crate) impl NodeAdminService for Backend {
    /// Creates a new node registration code.
    ///
    /// # Permissions
    /// Requires [`ManagementPermission::NODES_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::permission_denied, os::failure, db::failure <- [sql:*], cache::failure <- [redis:*])]
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
    #[error(node::not_found, auth::permission_denied, os::failure, db::failure <- [sql:*], cache::failure <- [redis:*])]
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
    #[error(auth::permission_denied, os::failure, db::failure <- [sql:*], cache::failure <- [redis:*])]
    async fn list_nodes(&self, #[special] auth: Authentication) -> Result<NodeList, _> {
        auth.require::<_, ListNodesError>((), ManagementPermissions::NODES_VIEW)?;
        Ok(NodeList {
            nodes: self.nodes.read().await.keys().cloned().collect(),
        })
    }
}

fn gen_code<E: FromOsFailure>() -> Result<String, E> {
    let mut data = [0u8; 8];
    OsRng
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
