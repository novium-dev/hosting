mod docker;
mod engine;
mod instances;
mod routes;
pub mod schema;

use crate::state::Agent;
use core::time::Duration;
use database_agent_common::integrity::{
    IntegrityCategory, IntegrityCheckInfo, IntegrityCheckResult, IntegrityFinding, IntegrityReport,
    IntegritySeverity,
};
use std::time::Instant;
use tracing::{error, warn};
use zelus::async_trait;

pub const CHECK_TIMEOUT: Duration = Duration::from_mins(5);

pub enum CheckError {
    Skipped(String),
    Failed(String),
}

impl From<anyhow::Error> for CheckError {
    fn from(err: anyhow::Error) -> Self {
        Self::Failed(format!("{err:#}"))
    }
}

impl From<sqlx::Error> for CheckError {
    fn from(err: sqlx::Error) -> Self {
        Self::Failed(format!("store error: {err}"))
    }
}

impl From<bollard::errors::Error> for CheckError {
    fn from(err: bollard::errors::Error) -> Self {
        Self::Failed(format!("docker error: {err}"))
    }
}

#[async_trait]
pub trait Check: Send + Sync {
    fn id(&self) -> &'static str;
    fn title(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn category(&self) -> IntegrityCategory;

    fn deep(&self) -> bool {
        false
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError>;
}

const CHECKS: &[&dyn Check] = &[
    &docker::DockerReachable,
    &docker::DockerContainers,
    &instances::InstanceState,
    &instances::InstanceDirectories,
    &engine::EngineDatabases,
    &engine::EngineUsers,
    &routes::RouteTable,
    &routes::Subsystems,
    &schema::SchemaDump,
];

#[must_use]
pub fn checks() -> Vec<IntegrityCheckInfo> {
    CHECKS
        .iter()
        .map(|check| IntegrityCheckInfo {
            id: check.id().to_owned(),
            title: check.title().to_owned(),
            description: check.description().to_owned(),
            category: check.category(),
            deep: check.deep(),
        })
        .collect()
}

pub async fn run(agent: &Agent, selected: Option<&[String]>, deep: bool) -> IntegrityReport {
    let started = Instant::now();
    let mut results = Vec::new();

    for check in CHECKS {
        let wanted = selected.is_none_or(|ids| ids.iter().any(|id| id == check.id()));
        if !wanted || (check.deep() && !deep) {
            continue;
        }
        results.push(run_one(agent, *check).await);
    }

    IntegrityReport::new(
        env!("GIT_HASH").trim().to_owned(),
        elapsed_ms(started),
        results,
    )
}

async fn run_one(agent: &Agent, check: &dyn Check) -> IntegrityCheckResult {
    let started = Instant::now();
    let outcome = tokio::time::timeout(CHECK_TIMEOUT, check.run(agent)).await;

    let (severity, findings, skipped) = match outcome {
        Ok(Ok(findings)) => (IntegrityCheckResult::severity_of(&findings), findings, None),
        Ok(Err(CheckError::Skipped(reason))) => (IntegritySeverity::Ok, Vec::new(), Some(reason)),
        Ok(Err(CheckError::Failed(reason))) => {
            error!("integrity check {} failed: {reason}", check.id());
            (
                IntegritySeverity::Error,
                vec![IntegrityFinding::error(format!(
                    "The check could not be completed: {reason}"
                ))],
                None,
            )
        }
        Err(_elapsed) => {
            warn!("integrity check {} timed out", check.id());
            (
                IntegritySeverity::Error,
                vec![IntegrityFinding::error(
                    "The check timed out before it could finish",
                )],
                None,
            )
        }
    };

    IntegrityCheckResult {
        id: check.id().to_owned(),
        title: check.title().to_owned(),
        description: check.description().to_owned(),
        category: check.category(),
        deep: check.deep(),
        severity,
        duration_ms: elapsed_ms(started),
        findings,
        skipped,
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}
