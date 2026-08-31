mod hosts;
mod nodes;
mod routes;
pub(crate) mod schema;
mod templates;

use super::{CHECK_TIMEOUT, Check, CheckError, HostCheck, NodeCheck};
use crate::Backend;
use crate::db::database::BackendDatabaseHost;
use crate::db::node::BackendNode;
use core::future::Future;
use daemon_common::integrity::{
    IntegrityCheckInfo, IntegrityCheckResult, IntegrityFinding, IntegrityReport, IntegritySeverity,
};
use std::time::Instant;
use tracing::{error, warn};

const CHECKS: &[&dyn Check] = &[
    &nodes::OrphanedPlacements,
    &templates::Templates,
    &routes::Routes,
    &schema::SchemaDump,
];

const NODE_CHECKS: &[&dyn NodeCheck] = &[
    &nodes::NodesReachable,
    &nodes::NodesVersion,
    &nodes::NodesConfig,
    &nodes::NodesServers,
    &nodes::NodesStorages,
    &nodes::NodesPorts,
];

const HOST_CHECKS: &[&dyn HostCheck] = &[
    &hosts::HostsReachable,
    &hosts::HostsVersion,
    &hosts::HostsInstances,
];

struct Metadata {
    id: &'static str,
    title: &'static str,
    description: &'static str,
    category: daemon_common::integrity::IntegrityCategory,
    deep: bool,
}

fn info(meta: &Metadata) -> IntegrityCheckInfo {
    IntegrityCheckInfo {
        id: meta.id.to_owned(),
        title: meta.title.to_owned(),
        description: meta.description.to_owned(),
        category: meta.category,
        deep: meta.deep,
    }
}

#[must_use]
pub(crate) fn checks() -> Vec<IntegrityCheckInfo> {
    CHECKS.iter().map(|check| info(&metadata(*check))).collect()
}

#[must_use]
pub(crate) fn node_checks() -> Vec<IntegrityCheckInfo> {
    NODE_CHECKS
        .iter()
        .map(|check| info(&node_metadata(*check)))
        .collect()
}

#[must_use]
pub(crate) fn host_checks() -> Vec<IntegrityCheckInfo> {
    HOST_CHECKS
        .iter()
        .map(|check| info(&host_metadata(*check)))
        .collect()
}

fn metadata(check: &dyn Check) -> Metadata {
    Metadata {
        id: check.id(),
        title: check.title(),
        description: check.description(),
        category: check.category(),
        deep: check.deep(),
    }
}

fn node_metadata(check: &dyn NodeCheck) -> Metadata {
    Metadata {
        id: check.id(),
        title: check.title(),
        description: check.description(),
        category: check.category(),
        deep: check.deep(),
    }
}

fn host_metadata(check: &dyn HostCheck) -> Metadata {
    Metadata {
        id: check.id(),
        title: check.title(),
        description: check.description(),
        category: check.category(),
        deep: check.deep(),
    }
}

fn wanted(meta: &Metadata, selected: Option<&[String]>, deep: bool) -> bool {
    selected.is_none_or(|ids| ids.iter().any(|id| id == meta.id)) && (!meta.deep || deep)
}

pub(crate) async fn run(
    backend: &Backend,
    selected: Option<&[String]>,
    deep: bool,
) -> IntegrityReport {
    let started = Instant::now();
    let mut results = Vec::new();

    for check in CHECKS {
        let meta = metadata(*check);
        if !wanted(&meta, selected, deep) {
            continue;
        }
        results.push(finish(&meta, check.run(backend)).await);
    }

    IntegrityReport::new(
        env!("GIT_HASH").trim().to_owned(),
        elapsed_ms(started),
        results,
    )
}

pub(crate) async fn run_node(
    backend: &Backend,
    node: &BackendNode,
    selected: Option<&[String]>,
    deep: bool,
) -> Vec<IntegrityCheckResult> {
    let mut results = Vec::new();

    for check in NODE_CHECKS {
        let meta = node_metadata(*check);
        if !wanted(&meta, selected, deep) {
            continue;
        }
        results.push(finish(&meta, check.run(backend, node)).await);
    }

    results
}

pub(crate) async fn run_host(
    backend: &Backend,
    host: &BackendDatabaseHost,
    selected: Option<&[String]>,
    deep: bool,
) -> Vec<IntegrityCheckResult> {
    let mut results = Vec::new();

    for check in HOST_CHECKS {
        let meta = host_metadata(*check);
        if !wanted(&meta, selected, deep) {
            continue;
        }
        results.push(finish(&meta, check.run(backend, host)).await);
    }

    results
}

async fn finish(
    meta: &Metadata,
    run: impl Future<Output = Result<Vec<IntegrityFinding>, CheckError>> + Send,
) -> IntegrityCheckResult {
    let started = Instant::now();
    let outcome = tokio::time::timeout(CHECK_TIMEOUT, run).await;

    let (severity, findings, skipped) = match outcome {
        Ok(Ok(findings)) => (IntegrityCheckResult::severity_of(&findings), findings, None),
        Ok(Err(CheckError::Skipped(reason))) => (IntegritySeverity::Ok, Vec::new(), Some(reason)),
        Ok(Err(CheckError::Failed(reason))) => {
            error!("Integrity check {} failed: {reason}", meta.id);
            (
                IntegritySeverity::Error,
                vec![IntegrityFinding::error(format!(
                    "The check could not be completed: {reason}"
                ))],
                None,
            )
        }
        Err(_elapsed) => {
            warn!("Integrity check {} timed out", meta.id);
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
        id: meta.id.to_owned(),
        title: meta.title.to_owned(),
        description: meta.description.to_owned(),
        category: meta.category,
        deep: meta.deep,
        severity,
        duration_ms: elapsed_ms(started),
        findings,
        skipped,
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}
