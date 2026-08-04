use crate::Backend;
use crate::db::region::RegionId;
use crate::define_id;
use core::str::FromStr as _;
use database_agent_common::sdk::DatabaseAgentSDK;
use database_agent_common::types::DatabaseType;
use serde::Serialize;
use sqlx::{Postgres, Transaction, query};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::error;
use url::Url;
use uuid::Uuid;

define_id!(DatabaseId);

pub const MAX_PROJECT_DATABASES: i64 = 4;

#[derive(Clone)]
pub struct BackendDatabaseHost {
    pub id: Uuid,
    pub display: String,
    pub region: RegionId,
    pub public_host: String,
    pub maintenance: bool,
    pub ports: HashMap<DatabaseType, u16>,
    pub sdk: Arc<DatabaseAgentSDK>,
}

impl BackendDatabaseHost {
    pub fn port(&self, kind: DatabaseType) -> u16 {
        self.ports
            .get(&kind)
            .copied()
            .unwrap_or_else(|| kind.default_port())
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct DatabaseInstanceRef {
    pub id: Uuid,
    pub host: Uuid,
    pub kind: DatabaseType,
    pub display: String,
}

impl Backend {
    pub async fn sync_database_hosts(
        &self,
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<(), sqlx::Error> {
        let mut hosts = HashMap::new();

        for host in query!(
            r#"SELECT id, display, region AS "region: RegionId", url, token, public_host,
                   maintenance AS "maintenance: bool"
               FROM database_hosts"#
        )
        .fetch_all(&mut **tx)
        .await?
        {
            let ports = query!(
                r#"SELECT type, port FROM database_host_ports WHERE host = $1"#,
                host.id
            )
            .fetch_all(&mut **tx)
            .await
            .inspect_err(|err| error!("Failed to select database host ports: {err:?}"))?
            .into_iter()
            .filter_map(|row| {
                let kind = DatabaseType::from_str(&row.type).ok()?;
                Some((kind, u16::try_from(row.port).ok()?))
            })
            .collect();

            let sdk = DatabaseAgentSDK::builder()
                .with_identifier(host.id)
                .with_url(Url::parse(&host.url).map_err(|err| sqlx::Error::Decode(Box::new(err)))?)
                .with_token(host.token)
                .build()
                .map_err(|err| sqlx::Error::Decode(Box::new(err)))?;

            hosts.insert(
                host.id,
                Arc::new(BackendDatabaseHost {
                    id: host.id,
                    display: host.display,
                    region: host.region,
                    public_host: host.public_host,
                    maintenance: host.maintenance,
                    ports,
                    sdk: Arc::new(sdk),
                }),
            );
        }

        *self.database_hosts.write().await = hosts;

        Ok(())
    }

    pub async fn database_host(&self, id: Uuid) -> Option<Arc<BackendDatabaseHost>> {
        self.database_hosts.read().await.get(&id).cloned()
    }
}
