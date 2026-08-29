use super::*;
use crate::integrity::{IntegrityCheckInfo, IntegrityReport, IntegritySchema};
use zelus::service;

define_error!(integrity {
    unavailable("The integrity subsystem is unavailable" INTERNAL_SERVER_ERROR),
});

#[service(path = "/integrity", tag = "integrity")]
pub trait IntegrityService {
    /// Lists every integrity check this agent can run.
    #[route("/checks", method = GET)]
    #[error()]
    async fn integrity_checks(&self) -> Result<Vec<IntegrityCheckInfo>, _>;

    /// Runs the selected integrity checks and returns their report.
    ///
    /// Passing no selection runs every check that is not marked as deep, unless
    /// `deep` is set.
    #[route("/run", method = PUT)]
    #[error(integrity::unavailable)]
    async fn integrity_run(
        &self,
        checks: Option<Vec<String>>,
        deep: bool,
    ) -> Result<IntegrityReport, _>;

    /// Dumps the schema of every table in the agent's own store.
    #[route("/schema", method = GET)]
    #[error(store::failure)]
    async fn integrity_schema(&self) -> Result<IntegritySchema, _>;
}
