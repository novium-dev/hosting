use super::*;
use crate::types::SystemStatus;
use zelus::service;

#[service(path = "/system", tag = "system")]
pub trait SystemService {
    /// Returns the agent version, uptime and the state of every proxy subsystem.
    #[route("/status", method = GET)]
    #[error()]
    async fn system_status(&self) -> Result<SystemStatus, _>;
}
