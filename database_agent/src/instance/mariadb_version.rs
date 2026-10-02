use crate::instance::{InnerInstance, Instance};
use crate::subsystems::mariadb::read_server_version;
use core::time::Duration;
use database_agent_common::types::ContainerState;
use std::sync::Weak;

const PROBE_INTERVAL: Duration = Duration::from_secs(2);
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn run(instance: Weak<InnerInstance>) {
    let mut recorded = false;

    loop {
        tokio::time::sleep(PROBE_INTERVAL).await;

        let Some(inner) = instance.upgrade() else {
            break;
        };
        let instance = Instance(inner);

        recorded = instance.container_state().await == ContainerState::Running
            && (recorded || instance.record_mariadb_version().await);
    }
}

impl Instance {
    async fn record_mariadb_version(&self) -> bool {
        let socket = self.socket_path().await;

        match tokio::time::timeout(PROBE_TIMEOUT, read_server_version(&socket)).await {
            Ok(Ok(version)) => {
                if self.agent.instance(self.uuid).await.is_none() {
                    return false;
                }

                if !self.agent.routes.mariadb_versions.set(self.uuid, &version) {
                    tracing::debug!(
                        instance = %self.uuid,
                        "ignoring the non-mariadb server version {version:?}"
                    );
                }

                true
            }
            Ok(Err(err)) => {
                tracing::debug!(instance = %self.uuid, "server version probe failed: {err}");
                false
            }
            Err(_) => {
                tracing::debug!(instance = %self.uuid, "server version probe timed out");
                false
            }
        }
    }
}
