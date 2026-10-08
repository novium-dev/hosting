use crate::Backend;
use crate::db::server::ports::NetworkProtocol;
use core::ops::Deref;
use daemon_common::sdk::DaemonSDK;
use daemon_common::service::DaemonServicesURLWithUserKey;
use serde::Serialize;
use sqlx::{Executor, PgConnection, Postgres, Transaction, query, query_as};
use std::collections::{HashMap, HashSet};
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
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub server_storages: Vec<String>,
    pub backup_storages: Vec<String>,
    pub ports: Vec<NodePortAllocation>,
    pub overallocation: u16,
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

impl Backend {
    pub(crate) async fn load_nodes(&self, conn: &mut PgConnection) -> Result<(), sqlx::Error> {
        let mut ports: HashMap<Uuid, Vec<NodePortAllocation>> = HashMap::new();
        for port in query_as!(
            NodePortAllocation,
            r#"SELECT id, node, protocol AS "protocol: NetworkProtocol", start, "end" FROM node_ports"#
        )
        .fetch_all(&mut *conn)
        .await?
        {
            ports.entry(port.node).or_default().push(port);
        }

        let mut nodes = HashMap::new();

        for node in query!(
            r#"SELECT
                id, url, display, maintenance AS "maintenance: bool", default_host, default_bind,
                ssh_host, ssh_port, overallocation,
                ARRAY(SELECT storage FROM node_server_storages WHERE node = nodes.id)
                    AS "server_storages!",
                ARRAY(SELECT storage FROM node_backup_storages WHERE node = nodes.id)
                    AS "backup_storages!"
             FROM nodes"#
        )
        .fetch_all(&mut *conn)
        .await?
        {
            let id = node.id;

            let sdk = Arc::new(
                DaemonSDK::builder()
                    .with_identifier(id)
                    .with_root_key(Arc::clone(&self.root_key))
                    .with_backend_key(Arc::clone(&self.key))
                    .with_url(
                        Url::parse(&node.url).map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
                    )
                    .with_user_key(self.user_key.clone())
                    .build(),
            );

            let services = sdk;

            nodes.insert(
                id,
                Arc::new(BackendNode {
                    id,
                    services,
                    display: node.display,
                    maintenance: node.maintenance,
                    default_host: node.default_host,
                    default_bind: node.default_bind,
                    ssh_host: node.ssh_host,
                    ssh_port: node.ssh_port.and_then(|port| u16::try_from(port).ok()),
                    server_storages: node.server_storages,
                    backup_storages: node.backup_storages,
                    ports: ports.remove(&id).unwrap_or_default(),
                    overallocation: u16::try_from(node.overallocation).unwrap_or(100),
                }),
            );
        }

        *self.nodes.write().await = nodes;

        Ok(())
    }
}

pub(crate) async fn used_ports(
    conn: impl Executor<'_, Database = Postgres>,
    node: Uuid,
) -> Result<HashMap<NetworkProtocol, HashSet<u16>>, sqlx::Error> {
    let mut used: HashMap<NetworkProtocol, HashSet<u16>> = HashMap::new();
    for row in query!(
        r#"SELECT
               server_ports.protocol AS "protocol: NetworkProtocol",
               lower(server_ports.external_port) AS "external_port_start!",
               upper(server_ports.external_port) - 1 AS "external_port_end!"
           FROM servers
           JOIN server_ports ON server_ports.server = servers.id
           WHERE servers.node = $1"#,
        node
    )
    .fetch_all(conn)
    .await?
    {
        used.entry(row.protocol).or_default().extend(
            (row.external_port_start..=row.external_port_end)
                .filter_map(|port| u16::try_from(port).ok()),
        );
    }
    Ok(used)
}

pub(crate) async fn insert_storages(
    tx: &mut Transaction<'_, Postgres>,
    id: &Uuid,
    storages: Vec<String>,
    backups: Vec<String>,
) -> Result<(), sqlx::Error> {
    for storage_id in storages {
        query!(
            r#"INSERT INTO node_server_storages (node,storage) VALUES ($1, $2)"#,
            id,
            storage_id
        )
        .execute(&mut **tx)
        .await
        .inspect_err(|err| {
            error!("Failed to insert node (server_storage, insertion): {err:?}");
        })?;
    }
    for storage_id in backups {
        query!(
            r#"INSERT INTO node_backup_storages (node,storage) VALUES ($1, $2)"#,
            id,
            storage_id
        )
        .execute(&mut **tx)
        .await
        .inspect_err(|err| error!("Failed to insert node (backup_storage, insertion): {err:?}"))?;
    }
    Ok(())
}

pub(crate) async fn replace_storages(
    tx: &mut Transaction<'_, Postgres>,
    id: &Uuid,
    storages: Vec<String>,
    backups: Vec<String>,
) -> Result<(), sqlx::Error> {
    query!("DELETE FROM node_server_storages WHERE node = $1", id)
        .execute(&mut **tx)
        .await
        .inspect_err(|err| error!("Unable to delete prior server storages: {err:?}"))?;
    query!("DELETE FROM node_backup_storages WHERE node = $1", id)
        .execute(&mut **tx)
        .await
        .inspect_err(|err| error!("Unable to delete prior backup storages: {err:?}"))?;

    insert_storages(tx, id, storages, backups).await
}
