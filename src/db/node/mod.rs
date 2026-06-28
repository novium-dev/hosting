use crate::Backend;
use crate::db::server::ports::NetworkProtocol;
use core::ops::Deref;
use daemon_common::node::{BackupStorage, ServerStorage};
use daemon_common::sdk::DaemonSDK;
use daemon_common::service::DaemonServicesURLWithUserKey;
use serde::Serialize;
use sqlx::{Postgres, Transaction, query, query_as};
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
    pub maintenance: bool,
    pub default_host: String,
    pub default_bind: String,
    pub server_storages: HashMap<String, ServerStorage>,
    pub backup_storages: HashMap<String, BackupStorage>,
    pub ports: Vec<NodePortAllocation>,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct NodePortAllocation {
    pub id: i32,
    pub node: Uuid,
    pub protocol: NetworkProtocol,
    pub start: i32,
    pub end: i32,
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
    pub maintenance: bool,

    pub default_host: String,
    pub default_bind: String,
}

impl Backend {
    pub async fn sync_nodes(&self, tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
        #[cfg(feature = "embedded_node")]
        use daemon_common::service::DaemonServices as _;

        let mut nodes = HashMap::new();
        for node in query!(r#"SELECT id,url,display,maintenance AS "maintenance: bool",default_host,default_bind FROM nodes"#)
            .fetch_all(&*self.database)
            .await? {

            let server_storages = query!(
                "SELECT * FROM node_server_storage WHERE node = $1",
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
                "SELECT * FROM node_backup_storage WHERE node = $1",
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
                r#"SELECT id,node,protocol AS "protocol: NetworkProtocol", start, "end" FROM node_ports WHERE node = $1"#,
                node.id
            )
            .fetch_all(&mut **tx)
            .await.inspect_err(|err| error!("Failed to select allocated ports: {err:?}"))?;

            let id = node.id;

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
                maintenance: node.maintenance,
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

/// Inserts the logical storage layout for a node.
pub(crate) async fn insert_storages(
    tx: &mut Transaction<'_, Postgres>,
    id: &Uuid,
    storages: HashMap<String, ServerStorage>,
    backups: HashMap<String, BackupStorage>,
) -> Result<(), sqlx::Error> {
    for (storage_id, storage) in storages {
        let storage_type = match storage {
            ServerStorage::Btrfs(_) => "btrfs",
            ServerStorage::Directory => "directory",
        };
        let group = match storage {
            ServerStorage::Btrfs(group) => Some(group),
            ServerStorage::Directory => None,
        };
        query!(r#"INSERT INTO node_server_storage (node,storage,storage_type,"group") VALUES ($1, $2, $3, $4)"#, id, storage_id, storage_type, group)
            .execute(&mut **tx)
            .await
            .inspect_err(|err| {
                error!("Failed to insert node (server_storage, insertion): {err:?}");
            })?;
    }
    for (storage_id, storage) in backups {
        let storage_type = match storage {
            BackupStorage::Btrfs(_) => "btrfs",
            BackupStorage::Archive => "archive",
        };
        let group = match storage {
            BackupStorage::Btrfs(group) => Some(group),
            BackupStorage::Archive => None,
        };
        query!(r#"INSERT INTO node_backup_storage (node,storage,storage_type,"group") VALUES ($1, $2, $3, $4)"#, id, storage_id, storage_type, group)
                .execute(&mut **tx)
                .await
                .inspect_err(|err| error!("Failed to insert node (backup_storage, insertion): {err:?}"))?;
    }
    Ok(())
}

/// Replaces the logical storage layout for an existing node (delete + insert).
pub(crate) async fn replace_storages(
    tx: &mut Transaction<'_, Postgres>,
    id: &Uuid,
    storages: HashMap<String, ServerStorage>,
    backups: HashMap<String, BackupStorage>,
) -> Result<(), sqlx::Error> {
    query!("DELETE FROM node_server_storage WHERE node = $1", id)
        .execute(&mut **tx)
        .await
        .inspect_err(|err| error!("Unable to delete prior server storages: {err:?}"))?;
    query!("DELETE FROM node_backup_storage WHERE node = $1", id)
        .execute(&mut **tx)
        .await
        .inspect_err(|err| error!("Unable to delete prior backup storages: {err:?}"))?;

    insert_storages(tx, id, storages, backups).await
}
