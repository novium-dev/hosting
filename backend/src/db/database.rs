use crate::Backend;
use crate::db::project::ProjectId;
use core::str::FromStr as _;
use database_agent_common::sdk::DatabaseAgentSDK;
use database_agent_common::types::DatabaseType;
use sqlx::{PgConnection, query, query_scalar};
use std::collections::HashMap;
use std::sync::Arc;
use url::Url;
use uuid::Uuid;

pub const MAX_PROJECT_INSTANCES: i64 = 4;

#[derive(Clone)]
pub struct BackendDatabaseHost {
    pub id: Uuid,
    pub display: String,
    pub groups: Vec<i32>,
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

pub struct ProjectInstance {
    pub id: Uuid,
    pub kind: DatabaseType,
    pub display: String,
    pub created: chrono::DateTime<chrono::Utc>,
    pub host: Arc<BackendDatabaseHost>,
}

impl Backend {
    pub(crate) async fn load_database_hosts(
        &self,
        conn: &mut PgConnection,
    ) -> Result<(), sqlx::Error> {
        let mut ports: HashMap<Uuid, HashMap<DatabaseType, u16>> = HashMap::new();
        for row in query!("SELECT host, kind, port FROM database_host_ports")
            .fetch_all(&mut *conn)
            .await?
        {
            if let (Ok(kind), Ok(port)) =
                (DatabaseType::from_str(&row.kind), u16::try_from(row.port))
            {
                ports.entry(row.host).or_default().insert(kind, port);
            }
        }

        let mut hosts = HashMap::new();

        for host in query!(
            r#"SELECT id, display, url, public_host,
                   maintenance AS "maintenance: bool",
                   ARRAY(SELECT group_id FROM database_host_groups WHERE host = database_hosts.id)
                       AS "groups!"
               FROM database_hosts"#
        )
        .fetch_all(&mut *conn)
        .await?
        {
            let sdk = DatabaseAgentSDK::builder()
                .with_identifier(host.id)
                .with_root_key(Arc::clone(&self.root_key))
                .with_backend_key(Arc::clone(&self.key))
                .with_url(Url::parse(&host.url).map_err(|err| sqlx::Error::Decode(Box::new(err)))?)
                .build();

            hosts.insert(
                host.id,
                Arc::new(BackendDatabaseHost {
                    id: host.id,
                    display: host.display,
                    groups: host.groups,
                    public_host: host.public_host,
                    maintenance: host.maintenance,
                    ports: ports.remove(&host.id).unwrap_or_default(),
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

    pub async fn project_instances<E: From<sqlx::Error>>(
        &self,
        project: ProjectId,
        instance: Option<Uuid>,
    ) -> Result<Vec<ProjectInstance>, E> {
        let rows = query!(
            r#"SELECT id, host, kind, display, created
               FROM database_instances
               WHERE project = $1 AND ($2::uuid IS NULL OR id = $2)
               ORDER BY created"#,
            &project,
            instance
        )
        .fetch_all(&*self.database)
        .await?;

        let hosts = self.database_hosts.read().await;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(ProjectInstance {
                    id: row.id,
                    kind: DatabaseType::from_str(&row.kind).ok()?,
                    display: row.display,
                    created: row.created,
                    host: Arc::clone(hosts.get(&row.host)?),
                })
            })
            .collect())
    }

    pub async fn pick_database_host<E: From<sqlx::Error>>(
        &self,
        project: ProjectId,
    ) -> Result<Option<Arc<BackendDatabaseHost>>, E> {
        let groups: Vec<i32> = query_scalar!(
            r#"SELECT DISTINCT node_groups.group_id
               FROM servers
               JOIN node_groups ON node_groups.node = servers.node
               WHERE servers.project = $1"#,
            &project
        )
        .fetch_all(&*self.database)
        .await?;

        let loads = query!(
            r#"SELECT database_hosts.id,
                   (SELECT COUNT(*) FROM database_instances
                    WHERE database_instances.host = database_hosts.id) AS "load!"
               FROM database_hosts
               WHERE database_hosts.maintenance = false
               ORDER BY 2 ASC"#
        )
        .fetch_all(&*self.database)
        .await?;

        let hosts = self.database_hosts.read().await;

        let mut preferred = None;
        let mut fallback = None;
        for row in loads {
            let Some(host) = hosts.get(&row.id) else {
                continue;
            };

            if host.groups.iter().any(|group| groups.contains(group)) {
                preferred = Some(Arc::clone(host));
                break;
            }
            if fallback.is_none() {
                fallback = Some(Arc::clone(host));
            }
        }
        drop(hosts);

        Ok(preferred.or(fallback))
    }
}
