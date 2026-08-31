mod hosts;
mod nodes;
mod routes;
pub(crate) mod schema;
mod templates;

use super::{CHECK_TIMEOUT, Check, CheckError};
use crate::Backend;
use daemon_common::integrity::{
    IntegrityCheckInfo, IntegrityCheckResult, IntegrityFinding, IntegrityReport, IntegritySeverity,
};
use std::time::Instant;
use tracing::{error, warn};

const CHECKS: &[&dyn Check] = &[
    &nodes::NodesReachable,
    &nodes::NodesVersion,
    &nodes::NodesConfig,
    &nodes::NodesServers,
    &nodes::NodesStorages,
    &nodes::NodesPorts,
    &hosts::HostsReachable,
    &hosts::HostsVersion,
    &hosts::HostsInstances,
    &templates::Templates,
    &routes::Routes,
    &schema::SchemaDump,
];

#[must_use]
pub(crate) fn checks() -> Vec<IntegrityCheckInfo> {
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

pub(crate) async fn run(
    backend: &Backend,
    selected: Option<&[String]>,
    deep: bool,
) -> IntegrityReport {
    let started = Instant::now();
    let mut results = Vec::new();

    for check in CHECKS {
        let wanted = selected.is_none_or(|ids| ids.iter().any(|id| id == check.id()));
        if !wanted || (check.deep() && !deep) {
            continue;
        }
        results.push(run_one(backend, *check).await);
    }

    IntegrityReport::new(
        env!("GIT_HASH").trim().to_owned(),
        elapsed_ms(started),
        results,
    )
}

async fn run_one(backend: &Backend, check: &dyn Check) -> IntegrityCheckResult {
    let started = Instant::now();
    let outcome = tokio::time::timeout(CHECK_TIMEOUT, check.run(backend)).await;

    let (severity, findings, skipped) = match outcome {
        Ok(Ok(findings)) => (IntegrityCheckResult::severity_of(&findings), findings, None),
        Ok(Err(CheckError::Skipped(reason))) => (IntegritySeverity::Ok, Vec::new(), Some(reason)),
        Ok(Err(CheckError::Failed(reason))) => {
            error!("Integrity check {} failed: {reason}", check.id());
            (
                IntegritySeverity::Error,
                vec![IntegrityFinding::error(format!(
                    "The check could not be completed: {reason}"
                ))],
                None,
            )
        }
        Err(_elapsed) => {
            warn!("Integrity check {} timed out", check.id());
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
