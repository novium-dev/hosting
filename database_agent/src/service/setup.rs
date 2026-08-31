use crate::state::Agent;
use database_agent_common::service::setup::SetupService;
use database_agent_common::service::setup::setup_service_error::ConfigError;
use database_agent_common::types::BackendAgentConfig;
use zelus::async_trait;

#[async_trait]
impl SetupService for Agent {
    async fn config(&self) -> Result<BackendAgentConfig, ConfigError> {
        Ok(self.config.to_backend_config())
    }
}
