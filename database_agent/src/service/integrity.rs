use crate::integrity;
use crate::state::Agent;
use database_agent_common::integrity::{IntegrityCheckInfo, IntegrityReport, IntegritySchema};
use database_agent_common::service::integrity::IntegrityService;
use database_agent_common::service::integrity::integrity_service_error::{
    IntegrityChecksError, IntegrityRunError, IntegritySchemaError,
};
use zelus::async_trait;

#[async_trait]
impl IntegrityService for Agent {
    async fn integrity_checks(&self) -> Result<Vec<IntegrityCheckInfo>, IntegrityChecksError> {
        Ok(integrity::checks())
    }

    async fn integrity_run(
        &self,
        checks: Option<Vec<String>>,
        deep: bool,
    ) -> Result<IntegrityReport, IntegrityRunError> {
        Ok(integrity::run(self, checks.as_deref(), deep).await)
    }

    async fn integrity_schema(&self) -> Result<IntegritySchema, IntegritySchemaError> {
        integrity::schema::dump(self.store.read())
            .await
            .map_err(|err| {
                tracing::error!("failed to dump the store schema: {err}");
                IntegritySchemaError::StoreFailure
            })
    }
}
