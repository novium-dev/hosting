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

fn catalogue() -> Vec<Box<dyn Check>> {
    vec![
        Box::new(nodes::NodesReachable),
        Box::new(nodes::NodesVersion),
        Box::new(nodes::NodesConfig),
        Box::new(nodes::NodesServers),
        Box::new(nodes::NodesStorages),
        Box::new(nodes::NodesPorts),
        Box::new(hosts::HostsReachable),
        Box::new(hosts::HostsVersion),
        Box::new(hosts::HostsInstances),
        Box::new(templates::Templates),
        Box::new(routes::Routes),
        Box::new(schema::SchemaDump),
    ]
}

#[must_use]
pub(crate) fn checks() -> Vec<IntegrityCheckInfo> {
    catalogue()
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

    for check in catalogue() {
        let wanted = selected.is_none_or(|ids| ids.iter().any(|id| id == check.id()));
        if !wanted || (check.deep() && !deep) {
            continue;
        }
        results.push(run_one(backend, check.as_ref()).await);
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
                    "The check timed out before it could finish".to_owned(),
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
