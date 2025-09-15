use crate::Backend;
use crate::db::server::ports::NetworkProtocol;
use core::ops::Deref;
use daemon_common::node::{BackupStorage, ServerStorage};
use daemon_common::sdk::DaemonSDK;
use daemon_common::service::DaemonServicesURLWithUserKey;
use serde::Serialize;
use sqlx::{MySql, Transaction, query, query_as};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::error;
use url::Url;
use uuid::Uuid;

#[derive(Clone)]
pub struct BackendNode {
    pub id: Uuid,
    pub services: Arc<dyn DaemonServicesURLWithUserKey + Send + Sync + 'static>,
    pub display: String,
    pub default_host: String,
    pub default_bind: String,
    pub server_storages: HashMap<String, ServerStorage>,
    pub backup_storages: HashMap<String, BackupStorage>,
    pub ports: Vec<NodePortAllocation>,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
pub struct NodePortAllocation {
    pub id: u32,
    pub node: Uuid,
    pub protocol: NetworkProtocol,
    pub start: u16,
    pub end: u16,
}

impl Deref for BackendNode {
    type Target = dyn DaemonServicesURLWithUserKey + Send + Sync + 'static;

    fn deref(&self) -> &Self::Target {
        &*self.services
    }
}

impl BackendNode {
    pub(crate) fn default_host(&self) -> &str {
        &self.default_host
    }

    pub(crate) fn default_bind(&self) -> &str {
        &self.default_bind
    }
}

pub struct NodeInfo {
    pub uuid: Uuid,
    pub display: String,

    pub default_host: String,
    pub default_bind: String,
}

impl Backend {
    pub async fn sync_nodes(&self, tx: &mut Transaction<'_, MySql>) -> Result<(), sqlx::Error> {
        #[cfg(feature = "embedded_node")]
        use daemon_common::service::DaemonServices as _;

        let mut nodes = HashMap::new();
        for node in query!("SELECT `id` AS `id: uuid::fmt::Hyphenated`,`url`,`display`,`default_host`,`default_bind` FROM `nodes`")
            .fetch_all(&*self.database)
            .await? {

            let server_storages = query!(
                "SELECT * FROM `node_server_storage` WHERE `node` = ?",
                node.id
            )
            .fetch_all(&mut **tx)
            .await
            .inspect_err(|err| error!("Failed to select server storages: {err:?}"))?
            .into_iter()
            .map(|storage| match storage.storage_type.as_str() {
                "btrfs" => (
                    storage.storage,
                    ServerStorage::Btrfs(storage.group.unwrap_or_default()),
                ),
                "directory" => (storage.storage, ServerStorage::Directory),
                _ => unreachable!(),
            })
            .collect();
            let backup_storages = query!(
                "SELECT * FROM `node_backup_storage` WHERE `node` = ?",
                node.id
            )
            .fetch_all(&mut **tx)
            .await
            .inspect_err(|err| error!("Failed to select backup storages: {err:?}"))?
            .into_iter()
            .map(|storage| match storage.storage_type.as_str() {
                "btrfs" => (
                    storage.storage,
                    BackupStorage::Btrfs(storage.group.unwrap_or_default()),
                ),
                "archive" => (storage.storage, BackupStorage::Archive),
                _ => unreachable!(),
            })
            .collect();
            let ports = query_as!(
                NodePortAllocation,
                "SELECT `id`,`node` AS `node: uuid::fmt::Hyphenated`,`protocol` AS `protocol: NetworkProtocol`, `start`, `end` FROM `node_ports` WHERE `node` = ?",
                node.id
            )
            .fetch_all(&mut **tx)
            .await.inspect_err(|err| error!("Failed to select allocated ports: {err:?}"))?;

            let id = node.id.into_uuid();

            let sdk = Arc::new(DaemonSDK::builder()
                .with_identifier(id)
                .with_root_key(Arc::clone(&self.root_key))
                .with_backend_key(Arc::clone(&self.key))
                .with_url(Url::parse(&node.url)
                    .map_err(|err| sqlx::Error::Decode(Box::new(err)))?)
                .with_user_key(self.user_key.clone())
                .build());

            #[cfg(feature = "embedded_node")]
            let services: Arc<dyn DaemonServicesURLWithUserKey + Send + Sync + 'static> = if id == self.embedded.id() {
                Arc::new(self.embedded.clone())
            } else {
                sdk
            };

            #[cfg(not(feature = "embedded_node"))]
            let services = sdk;

            nodes.insert(id, Arc::new(BackendNode {
                id,
                services,
                display: node.display,
                default_host: node.default_host,
                default_bind: node.default_bind,
                server_storages,
                backup_storages,
                ports,
            }));
        }

        *self.nodes.write().await = nodes;

        Ok(())
    }
}
