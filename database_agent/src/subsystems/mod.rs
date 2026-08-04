pub mod mariadb;
pub mod mongodb;
pub mod postgres;
pub mod redis;
pub mod scram;
pub mod status;

use crate::state::Agent;
use database_agent_common::types::{DatabaseType, SubsystemStatus};
use status::SubsystemConnections;
use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Default)]
pub struct SubsystemRegistry {
    mariadb: Arc<SubsystemConnections>,
    mongodb: Arc<SubsystemConnections>,
    postgres: Arc<SubsystemConnections>,
    redis: Arc<SubsystemConnections>,
}

impl SubsystemRegistry {
    pub const fn connections(&self, kind: DatabaseType) -> &Arc<SubsystemConnections> {
        match kind {
            DatabaseType::Mariadb => &self.mariadb,
            DatabaseType::Mongodb => &self.mongodb,
            DatabaseType::Postgres => &self.postgres,
            DatabaseType::Redis => &self.redis,
        }
    }

    pub fn snapshot(&self) -> BTreeMap<String, SubsystemStatus> {
        DatabaseType::ALL
            .iter()
            .map(|&kind| (kind.as_str().to_owned(), self.connections(kind).snapshot()))
            .collect()
    }
}

pub fn spawn_all(agent: &Agent) {
    for &kind in DatabaseType::ALL {
        if !agent.config.subsystem(kind).enabled {
            continue;
        }

        let agent = agent.clone();
        tokio::spawn(async move {
            let result = match kind {
                DatabaseType::Mariadb => mariadb::run(agent).await,
                DatabaseType::Mongodb => mongodb::run(agent).await,
                DatabaseType::Postgres => postgres::run(agent).await,
                DatabaseType::Redis => redis::run(agent).await,
            };

            if let Err(err) = result {
                tracing::error!("the {kind} subsystem stopped: {err:?}");
            }
        });
    }
}
