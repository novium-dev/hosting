use super::{
    IntegrityRun, IntegrityRunState, IntegritySource, IntegritySourceChecks, IntegritySourceReport,
    IntegritySourceSchema, SOURCE_TIMEOUT, agent, checks,
};
use crate::Backend;
use crate::cluster::{JOB_LOCK_TTL, JOB_RETENTION};
use crate::db::database::BackendDatabaseHost;
use crate::db::node::BackendNode;
use crate::integrity::describe_transport;
use daemon_common::integrity::{
    ExpectedServer, IntegrityCheckResult, IntegrityExpectation, IntegrityReport, IntegritySeverity,
};
use daemon_common::service::integrity::integrity_service_error::{
    IntegrityChecksError, IntegrityRunError, IntegritySchemaError,
};
use database_agent_common::service::integrity::IntegrityService as _;
use futures::StreamExt as _;
use sqlx::{query, query_scalar};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

const CONCURRENCY: usize = 4;

const RUN_KEY: &str = "integrity:run";
const RUN_LOCK: &str = "integrity:lock";

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

const fn succeeded(source: IntegritySource, report: IntegrityReport) -> IntegritySourceReport {
    IntegritySourceReport {
        source,
        severity: report.severity,
        report: Some(report),
        error: None,
    }
}

fn combine(
    source: IntegritySource,
    local: Vec<IntegrityCheckResult>,
    remote: Option<IntegrityReport>,
    error: Option<String>,
) -> IntegritySourceReport {
    let (version, duration_ms, mut checks) = remote.map_or_else(
        || (String::new(), 0u64, Vec::new()),
        |report| (report.version, report.duration_ms, report.checks),
    );

    let mut all = local;
    all.append(&mut checks);

    let report = IntegrityReport {
        severity: all
            .iter()
            .map(|check| check.severity)
            .max()
            .unwrap_or(IntegritySeverity::Ok),
        version,
        generated: chrono::Utc::now(),
        duration_ms,
        checks: all,
    };

    IntegritySourceReport {
        source,
        severity: report.severity,
        report: Some(report),
        error,
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

    pub(crate) async fn start_integrity_run(
        &self,
        selected: Option<Vec<String>>,
        deep: bool,
    ) -> bool {
        if !self.try_lock(RUN_LOCK, JOB_LOCK_TTL).await {
            return false;
        }

        let snapshot = {
            let mut run = self.integrity.write().await;

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
            };
            run.clone()
        };
        self.store_shared(RUN_KEY, &snapshot, JOB_RETENTION).await;

        let backend = self.clone();
        self.server_task_cancellable.lock().await.spawn(async move {
            let heartbeat = backend.hold_lock(RUN_LOCK.to_owned());
            backend.execute_integrity_run(selected, deep).await;
            drop(heartbeat);
            backend.release_lock(RUN_LOCK).await;
        });

        true
    }

    async fn update_run(&self, update: impl FnOnce(&mut IntegrityRun) + Send) {
        let snapshot = {
            let mut run = self.integrity.write().await;
            update(&mut run);
            run.clone()
        };
        self.store_shared(RUN_KEY, &snapshot, JOB_RETENTION).await;
    }

    async fn push_report(&self, report: IntegritySourceReport, step: String) {
        self.update_run(|run| {
            run.severity = run.severity.max(report.severity);
            run.reports.push(report);
            run.done = run.done.saturating_add(1);
            run.step = step;
        })
        .await;
    }

    pub(crate) async fn integrity_run_state(&self) -> Result<IntegrityRun, redis::RedisError> {
        let mut run = self
            .load_shared::<IntegrityRun>(RUN_KEY)
            .await?
            .unwrap_or_default();

        if run.state == IntegrityRunState::Running && !self.is_locked(RUN_LOCK).await {
            run.state = IntegrityRunState::Failed;
            run.error = Some("the instance running the checks stopped".to_owned());
        }

        Ok(run)
    }

    async fn node_expectation(&self, node: Uuid) -> IntegrityExpectation {
        let servers = query_scalar!(
            r#"SELECT node_server_id FROM servers WHERE node = $1"#,
            node
        )
        .fetch_all(&*self.database)
        .await
        .inspect_err(|err| error!("Unable to collect the expected servers of {node}: {err:?}"))
        .unwrap_or_default();

        let ids: HashSet<u32> = servers.into_iter().map(i32::cast_unsigned).collect();

        let mut schedules: HashMap<u32, HashSet<u32>> = HashMap::new();
        for row in query!(
            r#"SELECT servers.node_server_id, server_schedules.node_schedule_id AS "node_schedule_id!"
               FROM server_schedules
               JOIN servers ON servers.id = server_schedules.server
               WHERE servers.node = $1 AND server_schedules.node_schedule_id IS NOT NULL"#,
            node
        )
        .fetch_all(&*self.database)
        .await
        .inspect_err(|err| error!("Unable to collect the expected schedules of {node}: {err:?}"))
        .unwrap_or_default()
        {
            schedules
                .entry(row.node_server_id.cast_unsigned())
                .or_default()
                .insert(row.node_schedule_id.cast_unsigned());
        }

        IntegrityExpectation {
            servers: Some(
                ids.iter()
                    .map(|id| {
                        (
                            *id,
                            ExpectedServer {
                                schedules: Some(schedules.remove(id).unwrap_or_default()),
                            },
                        )
                    })
                    .collect(),
            ),
            databases: None,
            storages: Some(ids),
        }
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

        let mut targets = Vec::new();
        for node in self.nodes_sorted().await {
            let expected = self.node_expectation(node.id).await;
            targets.push((node, expected));
        }

        let mut stream = futures::stream::iter(
            targets
                .into_iter()
                .map(|(node, expected)| run_node(self, node, selected.clone(), deep, expected)),
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
                .map(|host| run_host(self, host, selected.clone(), deep)),
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
                Ok(mut remote) => {
                    let mut all = checks::node_checks();
                    all.append(&mut remote);
                    IntegritySourceChecks {
                        source,
                        checks: all,
                        error: None,
                    }
                }
                Err(err) => IntegritySourceChecks {
                    source,
                    checks: checks::node_checks(),
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
                Ok(remote) => {
                    let mut all = checks::host_checks();
                    all.extend(remote.into_iter().map(agent::check_info));
                    IntegritySourceChecks {
                        source,
                        checks: all,
                        error: None,
                    }
                }
                Err(err) => IntegritySourceChecks {
                    source,
                    checks: checks::host_checks(),
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
    backend: &Backend,
    node: Arc<BackendNode>,
    selected: Option<Vec<String>>,
    deep: bool,
    expected: IntegrityExpectation,
) -> IntegritySourceReport {
    let source = node_source(&node);
    let local = checks::run_node(backend, &node, selected.as_deref(), deep).await;
    let call = node.integrity_run(selected, deep, Some(expected));

    let (remote, error) = match tokio::time::timeout(SOURCE_TIMEOUT, call).await {
        Ok(Ok(report)) => (Some(report), None),
        Ok(Err(IntegrityRunError::Communication(inner))) => {
            (None, Some(describe_transport(&inner)))
        }
        Ok(Err(other)) => (
            None,
            Some(format!("the node refused to run its checks: {other:?}")),
        ),
        Err(_elapsed) => (
            None,
            Some("the node did not finish its checks in time".to_owned()),
        ),
    };

    combine(source, local, remote, error)
}

async fn run_host(
    backend: &Backend,
    host: Arc<BackendDatabaseHost>,
    selected: Option<Vec<String>>,
    deep: bool,
) -> IntegritySourceReport {
    let source = host_source(&host);
    let local = checks::run_host(backend, &host, selected.as_deref(), deep).await;
    let call = host.sdk.integrity_run(selected, deep);

    let (remote, error) = match tokio::time::timeout(SOURCE_TIMEOUT, call).await {
        Ok(Ok(report)) => (Some(agent::report(report)), None),
        Ok(Err(other)) => (
            None,
            Some(format!(
                "the database host refused to run its checks: {other:?}"
            )),
        ),
        Err(_elapsed) => (
            None,
            Some("the database host did not finish its checks in time".to_owned()),
        ),
    };

    combine(source, local, remote, error)
}
