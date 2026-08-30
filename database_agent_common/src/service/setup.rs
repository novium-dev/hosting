use super::*;
use crate::types::BackendAgentConfig;
use zelus::service;

#[service(tag = "setup")]
pub trait SetupService {
    /// Returns the agent's current config (backend-driven update)
    #[route("/setup/config", method = GET)]
    #[error((AwaitingSetup, "This error is expected while in the setup wizard", FORBIDDEN))]
    async fn config(&self) -> Result<BackendAgentConfig, _>;
}
