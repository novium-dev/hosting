use super::{
    IntegrityRun, IntegrityRunState, IntegritySource, IntegritySourceChecks, IntegritySourceReport,
    IntegritySourceSchema, SOURCE_TIMEOUT, agent, checks,
};
use crate::Backend;
use crate::db::database::BackendDatabaseHost;
use crate::db::node::BackendNode;
use crate::integrity::describe_transport;
use daemon_common::integrity::{IntegrityReport, IntegritySeverity};
use daemon_common::service::integrity::integrity_service_error::{
    IntegrityChecksError, IntegrityRunError, IntegritySchemaError,
};
use database_agent_common::service::integrity::IntegrityService as _;
use futures::StreamExt as _;
use std::sync::Arc;
use tracing::{error, info};

const CONCURRENCY: usize = 4;

fn node_source(node: &BackendNode) -> IntegritySource {
    IntegritySource::Node {
        id: node.id,
        display: node.display.clone(),
    }
}

fn host_source(host: &BackendDatabaseHost) -> IntegritySource {
    IntegritySource::DatabaseHost {
        id: host.id,
        display: host.display.clone(),
    }
}

const fn failed(source: IntegritySource, error: String) -> IntegritySourceReport {
    IntegritySourceReport {
        source,
        severity: IntegritySeverity::Error,
        report: None,
        error: Some(error),
    }
}

const fn succeeded(source: IntegritySource, report: IntegrityReport) -> IntegritySourceReport {
    IntegritySourceReport {
        source,
        severity: report.severity,
        report: Some(report),
        error: None,
    }
}

impl Backend {
    async fn nodes_sorted(&self) -> Vec<Arc<BackendNode>> {
        let mut nodes: Vec<Arc<BackendNode>> = self.nodes.read().await.values().cloned().collect();
        nodes.sort_by(|left, right| left.display.cmp(&right.display));
        nodes
    }

    async fn hosts_sorted(&self) -> Vec<Arc<BackendDatabaseHost>> {
        let mut hosts: Vec<Arc<BackendDatabaseHost>> =
            self.database_hosts.read().await.values().cloned().collect();
        hosts.sort_by(|left, right| left.display.cmp(&right.display));
        hosts
    }

    /// Starts a background integrity run, unless one is already in flight.
    pub(crate) async fn start_integrity_run(
        &self,
        selected: Option<Vec<String>>,
        deep: bool,
    ) -> bool {
        {
            let mut run = self.integrity.write().await;
            if run.state == IntegrityRunState::Running {
                return false;
            }

            let total = 1u32
                .saturating_add(u32::try_from(self.nodes.read().await.len()).unwrap_or(u32::MAX))
                .saturating_add(
                    u32::try_from(self.database_hosts.read().await.len()).unwrap_or(u32::MAX),
                );

            *run = IntegrityRun {
                state: IntegrityRunState::Running,
                deep,
                step: "Starting".to_owned(),
                done: 0,
                total,
                severity: IntegritySeverity::Ok,
                reports: Vec::new(),
                error: None,
                started_at: Some(chrono::Utc::now().timestamp()),
                finished_at: None,
            }
        };

        let backend = self.clone();
        self.server_task_cancellable
            .lock()
            .await
            .spawn(async move { backend.execute_integrity_run(selected, deep).await });

        true
    }

    async fn update_run(&self, update: impl FnOnce(&mut IntegrityRun) + Send) {
        update(&mut *self.integrity.write().await);
    }

    async fn push_report(&self, report: IntegritySourceReport, step: String) {
        let mut run = self.integrity.write().await;
        run.severity = run.severity.max(report.severity);
        run.reports.push(report);
        run.done = run.done.saturating_add(1);
        run.step = step;
    }

    async fn execute_integrity_run(&self, selected: Option<Vec<String>>, deep: bool) {
        info!("Running integrity checks (deep: {deep})");

        self.update_run(|run| "Checking the backend".clone_into(&mut run.step))
            .await;
        let local = checks::run(self, selected.as_deref(), deep).await;
        self.push_report(
            succeeded(IntegritySource::Backend, local),
            "Checking nodes".to_owned(),
        )
        .await;

        let nodes = self.nodes_sorted().await;
        let mut stream = futures::stream::iter(
            nodes
                .into_iter()
                .map(|node| run_node(node, selected.clone(), deep)),
        )
        .buffer_unordered(CONCURRENCY);

        while let Some(report) = stream.next().await {
            self.push_report(report, "Checking nodes".to_owned()).await;
        }
        drop(stream);

        let hosts = self.hosts_sorted().await;
        let mut stream = futures::stream::iter(
            hosts
                .into_iter()
                .map(|host| run_host(host, selected.clone(), deep)),
        )
        .buffer_unordered(CONCURRENCY);

        while let Some(report) = stream.next().await {
            self.push_report(report, "Checking database hosts".to_owned())
                .await;
        }
        drop(stream);

        self.update_run(|run| {
            run.state = IntegrityRunState::Completed;
            "Finished".clone_into(&mut run.step);
            run.finished_at = Some(chrono::Utc::now().timestamp());
        })
        .await;

        info!("Integrity checks finished");
    }

    pub(crate) async fn integrity_catalogue(&self) -> Vec<IntegritySourceChecks> {
        let mut catalogue = vec![IntegritySourceChecks {
            source: IntegritySource::Backend,
            checks: checks::checks(),
            error: None,
        }];

        for node in self.nodes_sorted().await {
            let source = node_source(&node);
            catalogue.push(match node.integrity_checks().await {
                Ok(checks) => IntegritySourceChecks {
                    source,
                    checks,
                    error: None,
                },
                Err(err) => IntegritySourceChecks {
                    source,
                    checks: Vec::new(),
                    error: Some(match err {
                        IntegrityChecksError::Communication(inner) => describe_transport(&inner),
                        other @ IntegrityChecksError::AuthInvalid => format!("{other:?}"),
                    }),
                },
            });
        }

        for host in self.hosts_sorted().await {
            let source = host_source(&host);
            catalogue.push(match host.sdk.integrity_checks().await {
                Ok(checks) => IntegritySourceChecks {
                    source,
                    checks: checks.into_iter().map(agent::check_info).collect(),
                    error: None,
                },
                Err(err) => IntegritySourceChecks {
                    source,
                    checks: Vec::new(),
                    error: Some(format!("{err:?}")),
                },
            });
        }

        catalogue
    }

    pub(crate) async fn integrity_schemas(&self) -> Vec<IntegritySourceSchema> {
        let mut schemas = vec![match checks::schema::dump(&self.database).await {
            Ok(schema) => IntegritySourceSchema {
                source: IntegritySource::Backend,
                schema: Some(schema),
                error: None,
            },
            Err(err) => {
                error!("Unable to dump the backend schema: {err:?}");
                IntegritySourceSchema {
                    source: IntegritySource::Backend,
                    schema: None,
                    error: Some(format!("{err}")),
                }
            }
        }];

        for node in self.nodes_sorted().await {
            let source = node_source(&node);
            schemas.push(match node.integrity_schema().await {
                Ok(schema) => IntegritySourceSchema {
                    source,
                    schema: Some(schema),
                    error: None,
                },
                Err(err) => IntegritySourceSchema {
                    source,
                    schema: None,
                    error: Some(match err {
                        IntegritySchemaError::Communication(inner) => describe_transport(&inner),
                        other => format!("{other:?}"),
                    }),
                },
            });
        }

        for host in self.hosts_sorted().await {
            let source = host_source(&host);
            schemas.push(match host.sdk.integrity_schema().await {
                Ok(schema) => IntegritySourceSchema {
                    source,
                    schema: Some(agent::schema(schema)),
                    error: None,
                },
                Err(err) => IntegritySourceSchema {
                    source,
                    schema: None,
                    error: Some(format!("{err:?}")),
                },
            });
        }

        schemas
    }
}

async fn run_node(
    node: Arc<BackendNode>,
    selected: Option<Vec<String>>,
    deep: bool,
) -> IntegritySourceReport {
    let source = node_source(&node);

    match tokio::time::timeout(SOURCE_TIMEOUT, node.integrity_run(selected, deep)).await {
        Ok(Ok(report)) => succeeded(source, report),
        Ok(Err(IntegrityRunError::Communication(inner))) => {
            failed(source, describe_transport(&inner))
        }
        Ok(Err(other)) => failed(
            source,
            format!("the node refused to run its checks: {other:?}"),
        ),
        Err(_elapsed) => failed(
            source,
            "the node did not finish its checks in time".to_owned(),
        ),
    }
}

async fn run_host(
    host: Arc<BackendDatabaseHost>,
    selected: Option<Vec<String>>,
    deep: bool,
) -> IntegritySourceReport {
    let source = host_source(&host);

    match tokio::time::timeout(SOURCE_TIMEOUT, host.sdk.integrity_run(selected, deep)).await {
        Ok(Ok(report)) => succeeded(source, agent::report(report)),
        Ok(Err(other)) => failed(
            source,
            format!("the database host refused to run its checks: {other:?}"),
        ),
        Err(_elapsed) => failed(
            source,
            "the database host did not finish its checks in time".to_owned(),
        ),
    }
}
