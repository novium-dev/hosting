use crate::state::Agent;
use database_agent_common::service::system::SystemService;
use database_agent_common::service::system::system_service_error::SystemStatusError;
use database_agent_common::types::SystemStatus;
use zelus::async_trait;

#[async_trait]
impl SystemService for Agent {
    async fn system_status(&self) -> Result<SystemStatus, SystemStatusError> {
        Ok(SystemStatus {
            version: env!("GIT_HASH").to_owned(),
            api_hash: database_agent_common::API_HASH.to_owned(),
            uptime: self.started.elapsed().as_secs(),
            instance_count: self.instances.read().await.len(),
            subsystems: self.subsystems.snapshot(),
        })
    }
}
