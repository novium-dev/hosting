pub(crate) mod agent;
pub(crate) mod checks;
pub(crate) mod run;

use crate::Backend;
use core::time::Duration;
use daemon_common::integrity::{
    IntegrityCategory, IntegrityCheckInfo, IntegrityFinding, IntegrityReport, IntegritySchema,
    IntegritySeverity,
};
use serde::Serialize;
use uuid::Uuid;
use zelus::async_trait;

pub(crate) const CHECK_TIMEOUT: Duration = Duration::from_secs(300);
pub(crate) const MIN_DAEMON_PROTOCOL_VERSION: u32 = 1;
pub(crate) const SOURCE_TIMEOUT: Duration = Duration::from_mins(15);

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum IntegritySource {
    Backend,
    Node { id: Uuid, display: String },
    DatabaseHost { id: Uuid, display: String },
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct IntegritySourceReport {
    pub(crate) source: IntegritySource,
    pub(crate) severity: IntegritySeverity,
    pub(crate) report: Option<IntegrityReport>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct IntegritySourceChecks {
    pub(crate) source: IntegritySource,
    pub(crate) checks: Vec<IntegrityCheckInfo>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct IntegritySourceSchema {
    pub(crate) source: IntegritySource,
    pub(crate) schema: Option<IntegritySchema>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum IntegrityRunState {
    Idle,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct IntegrityRun {
    pub(crate) state: IntegrityRunState,
    pub(crate) deep: bool,
    pub(crate) step: String,
    pub(crate) done: u32,
    pub(crate) total: u32,
    pub(crate) severity: IntegritySeverity,
    pub(crate) reports: Vec<IntegritySourceReport>,
    pub(crate) error: Option<String>,
    pub(crate) started_at: Option<i64>,
    pub(crate) finished_at: Option<i64>,
}

impl Default for IntegrityRun {
    fn default() -> Self {
        Self {
            state: IntegrityRunState::Idle,
            deep: false,
            step: String::new(),
            done: 0,
            total: 0,
            severity: IntegritySeverity::Ok,
            reports: Vec::new(),
            error: None,
            started_at: None,
            finished_at: None,
        }
    }
}

pub(crate) enum CheckError {
    Skipped(String),
    Failed(String),
}

impl From<sqlx::Error> for CheckError {
    fn from(err: sqlx::Error) -> Self {
        Self::Failed(format!("database error: {err}"))
    }
}

#[async_trait]
pub(crate) trait Check: Send + Sync {
    fn id(&self) -> &'static str;
    fn title(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn category(&self) -> IntegrityCategory;

    fn deep(&self) -> bool {
        false
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError>;
}

/// Turns a transport failure into a message that says which layer gave up, so
/// an unreachable node can be told apart from one that answered with a
/// certificate the backend does not trust.
pub(crate) fn describe_transport(err: &zelus::reqwest::Error) -> String {
    let mut chain = Vec::new();
    let mut source: Option<&(dyn core::error::Error + 'static)> = Some(err);
    while let Some(current) = source {
        chain.push(current.to_string());
        source = current.source();
    }
    let joined = chain.join(": ");
    let lowered = joined.to_lowercase();

    if lowered.contains("certificate")
        || lowered.contains("bad_certificate")
        || lowered.contains("unknown issuer")
        || lowered.contains("invalidcertificate")
        || lowered.contains("handshake")
        || lowered.contains("tls")
    {
        return format!("the node presented a certificate the backend rejected ({joined})");
    }
    if err.is_timeout() {
        return format!("the node did not answer in time ({joined})");
    }
    if err.is_connect() {
        return format!("the backend could not open a connection to the node ({joined})");
    }
    joined
}
