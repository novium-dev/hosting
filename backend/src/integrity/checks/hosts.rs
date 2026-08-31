use crate::Backend;
use crate::db::database::BackendDatabaseHost;
use crate::integrity::{Check, CheckError, describe_transport};
use daemon_common::integrity::{IntegrityCategory, IntegrityFinding};
use database_agent_common::API_HASH;
use database_agent_common::service::instance::InstanceService as _;
use database_agent_common::service::instance::instance_service_error::ListInstancesError;
use database_agent_common::service::system::SystemService as _;
use database_agent_common::service::system::system_service_error::SystemStatusError;
use database_agent_common::types::{DatabaseType, SystemStatus};
use sqlx::query;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use uuid::Uuid;
use zelus::async_trait;

async fn hosts(backend: &Backend) -> Vec<Arc<BackendDatabaseHost>> {
    let mut hosts: Vec<Arc<BackendDatabaseHost>> = backend
        .database_hosts
        .read()
        .await
        .values()
        .cloned()
        .collect();
    hosts.sort_by(|left, right| left.display.cmp(&right.display));
    hosts
}

async fn status(host: &BackendDatabaseHost) -> Result<SystemStatus, String> {
    host.sdk.system_status().await.map_err(|err| match err {
        SystemStatusError::Communication(inner) => describe_transport(&inner),
        other @ SystemStatusError::AuthInvalid => {
            format!("the host answered with an error: {other:?}")
        }
    })
}

fn subject(host: &BackendDatabaseHost) -> String {
    format!("{} ({})", host.display, host.id)
}

pub(crate) struct HostsReachable;

#[async_trait]
impl Check for HostsReachable {
    fn id(&self) -> &'static str {
        "database_hosts.reachable"
    }

    fn title(&self) -> &'static str {
        "Database hosts are reachable"
    }

    fn description(&self) -> &'static str {
        "Every registered database host must answer its agent api, and the proxy subsystem of \
         every engine it serves must be listening. A host that is down takes every database on it \
         offline."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Connectivity
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let hosts = hosts(backend).await;
        if hosts.is_empty() {
            return Err(CheckError::Skipped(
                "No database host is registered on this instance".to_owned(),
            ));
        }

        let mut findings = Vec::new();
        for host in hosts {
            match status(&host).await {
                Ok(status) => {
                    findings.push(
                        IntegrityFinding::info("The database host answered".to_owned())
                            .with_subject(subject(&host))
                            .with_detail("version", status.version.clone())
                            .with_detail("api", status.api_hash.clone())
                            .with_detail("uptime_seconds", status.uptime.to_string())
                            .with_detail("instances", status.instance_count.to_string())
                            .with_detail("maintenance", host.maintenance.to_string()),
                    );

                    for kind in DatabaseType::ALL {
                        let offered = host.ports.contains_key(kind);
                        let running = status
                            .subsystems
                            .get(kind.as_str())
                            .is_some_and(|subsystem| subsystem.running);

                        if offered && !running {
                            findings.push(
                                IntegrityFinding::error(format!(
                                    "The backend publishes a {kind} port for this host, but its \
                                     {kind} subsystem is not listening"
                                ))
                                .with_subject(subject(&host))
                                .with_detail("engine", kind.as_str().to_owned())
                                .with_detail("port", host.port(*kind).to_string()),
                            );
                        }
                    }
                }
                Err(reason) => findings.push(
                    IntegrityFinding::error(format!(
                        "The database host is not reachable: {reason}"
                    ))
                    .with_subject(subject(&host))
                    .with_detail("maintenance", host.maintenance.to_string()),
                ),
            }
        }

        Ok(findings)
    }
}

pub(crate) struct HostsVersion;

#[async_trait]
impl Check for HostsVersion {
    fn id(&self) -> &'static str {
        "database_hosts.version"
    }

    fn title(&self) -> &'static str {
        "Database hosts were built against the same agent API as the backend"
    }

    fn description(&self) -> &'static str {
        "Both sides carry a fingerprint of the shared agent service definitions they were \
         compiled from. A host whose fingerprint differs answers a different shape of the api \
         than this backend calls, whatever commit it reports."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Version
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let hosts = hosts(backend).await;
        if hosts.is_empty() {
            return Err(CheckError::Skipped(
                "No database host is registered on this instance".to_owned(),
            ));
        }

        let mut findings = Vec::new();
        for host in hosts {
            let Ok(status) = status(&host).await else {
                continue;
            };
            if status.api_hash != API_HASH {
                findings.push(
                    IntegrityFinding::error(
                        "The database host was built against different agent service definitions \
                         than this backend; the two do not agree on the shape of the api"
                            .to_owned(),
                    )
                    .with_subject(subject(&host))
                    .with_detail("host_api", display_hash(&status.api_hash))
                    .with_detail("host_commit", status.version)
                    .with_detail("backend_api", API_HASH.to_owned()),
                );
            }
        }

        Ok(findings)
    }
}

pub(crate) struct HostsInstances;

#[async_trait]
impl Check for HostsInstances {
    fn id(&self) -> &'static str {
        "database_hosts.instances"
    }

    fn title(&self) -> &'static str {
        "Database instances exist on both sides"
    }

    fn description(&self) -> &'static str {
        "Every instance the backend has recorded must exist on its host, and a host must not run \
         instances the backend has forgotten. An orphan instance keeps its container, volume and \
         proxy routes; a missing one leaves a project with a database it cannot reach."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Database
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let hosts = hosts(backend).await;
        if hosts.is_empty() {
            return Err(CheckError::Skipped(
                "No database host is registered on this instance".to_owned(),
            ));
        }

        let rows = query!(
            r#"SELECT id, host, project, type, display FROM database_instances ORDER BY host, id"#
        )
        .fetch_all(&*backend.database)
        .await?;

        let mut expected: HashMap<Uuid, HashMap<Uuid, (String, String)>> = HashMap::new();
        for row in rows {
            expected
                .entry(row.host)
                .or_default()
                .insert(row.id, (row.display, row.project.clone()));
        }

        let mut findings = Vec::new();
        for host in hosts {
            let actual = match host.sdk.list_instances().await {
                Ok(instances) => instances,
                Err(ListInstancesError::Communication(inner)) => {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The host's instance list could not be pulled: {}",
                            describe_transport(&inner)
                        ))
                        .with_subject(subject(&host)),
                    );
                    continue;
                }
                Err(other) => {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The host refused to list its instances: {other:?}"
                        ))
                        .with_subject(subject(&host)),
                    );
                    continue;
                }
            };

            let present: HashSet<Uuid> = actual.iter().map(|instance| instance.data.uuid).collect();
            let known = expected.remove(&host.id).unwrap_or_default();

            for (id, (display, project)) in &known {
                if !present.contains(id) {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "Instance {display} is recorded on this host, but the host does not \
                             run it"
                        ))
                        .with_subject(id.to_string())
                        .with_detail("host", subject(&host))
                        .with_detail("project", project.clone()),
                    );
                }
            }

            for instance in actual {
                if !known.contains_key(&instance.data.uuid) {
                    findings.push(
                        IntegrityFinding::error(
                            "The host runs an instance the backend has no record of. Its \
                             container, volume and proxy routes are never cleaned up"
                                .to_owned(),
                        )
                        .with_subject(instance.data.uuid.to_string())
                        .with_detail("host", subject(&host))
                        .with_detail("engine", instance.data.database_type.as_str().to_owned())
                        .with_detail("databases", instance.database_count.to_string()),
                    );
                }
            }
        }

        for (host, instances) in expected {
            for (id, (display, project)) in instances {
                findings.push(
                    IntegrityFinding::error(format!(
                        "Instance {display} is recorded on host {host}, which is not registered \
                         on this instance"
                    ))
                    .with_subject(id.to_string())
                    .with_detail("host", host.to_string())
                    .with_detail("project", project),
                );
            }
        }

        Ok(findings)
    }
}

fn display_hash(hash: &str) -> String {
    if hash.is_empty() {
        "unknown (the host predates the fingerprint)".to_owned()
    } else {
        hash.to_owned()
    }
}
