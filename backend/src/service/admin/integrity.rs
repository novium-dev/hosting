use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::integrity::{IntegrityRun, IntegritySourceChecks, IntegritySourceSchema};
use crate::service::admin::integrity::integrity_admin_service_error::{
    IntegrityReportError, IntegritySchemaError, ListIntegrityChecksError, RunIntegrityChecksError,
};
use crate::service::*;
use zelus::service;

#[service(path = "/admin/integrity", tag = "integrity", no_sdk)]
pub(crate) impl IntegrityAdminService for Backend {
    /// Lists every integrity check this instance can run, grouped by the
    /// backend, each node and each database host.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::INTEGRITY_VIEW`].
    #[route("/checks", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_integrity_checks(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<IntegritySourceChecks>, _> {
        auth.require::<_, _, ListIntegrityChecksError>((), ManagementPermissions::INTEGRITY_VIEW)?;

        Ok(self.integrity_catalogue().await)
    }

    /// Returns the state of the current or last integrity run together with
    /// every report it produced.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::INTEGRITY_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn integrity_report(&self, #[special] auth: Authentication) -> Result<IntegrityRun, _> {
        auth.require::<_, _, IntegrityReportError>((), ManagementPermissions::INTEGRITY_VIEW)?;

        Ok(self.integrity.read().await.clone())
    }

    /// Starts an integrity run in the background.
    ///
    /// Passing no selection runs every check that is not marked as deep, unless
    /// `deep` is set. Deep checks read every backup on every node in full.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::INTEGRITY_VIEW`].
    #[route("/run", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, integrity::already_running, db::failure <- [sql:*])]
    async fn run_integrity_checks(
        &self,
        #[special] auth: Authentication,
        checks: Option<Vec<String>>,
        deep: bool,
    ) -> Result<(), _> {
        auth.require::<_, _, RunIntegrityChecksError>((), ManagementPermissions::INTEGRITY_VIEW)?;

        if self.start_integrity_run(checks, deep).await {
            Ok(())
        } else {
            Err(RunIntegrityChecksError::IntegrityAlreadyRunning)
        }
    }

    /// Dumps the database schema of the backend, of every node and of every
    /// database host.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::INTEGRITY_VIEW`].
    #[route("/schema", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn integrity_schema(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<IntegritySourceSchema>, _> {
        auth.require::<_, _, IntegritySchemaError>((), ManagementPermissions::INTEGRITY_VIEW)?;

        Ok(self.integrity_schemas().await)
    }
}
