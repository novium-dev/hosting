use crate::Backend;
use crate::db::database::BackendDatabaseHost;
use crate::db::project::ProjectId;
use crate::integrity::{CheckError, HostCheck, describe_transport};
use daemon_common::integrity::{IntegrityCategory, IntegrityFinding};
use database_agent_common::service::instance::InstanceService as _;
use database_agent_common::service::instance::instance_service_error::ListInstancesError;
use database_agent_common::service::system::SystemService as _;
use database_agent_common::service::system::system_service_error::SystemStatusError;
use database_agent_common::types::{DatabaseType, SystemStatus};
use sqlx::query;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use zelus::async_trait;

async fn status(host: &BackendDatabaseHost) -> Result<SystemStatus, String> {
    host.sdk.system_status().await.map_err(|err| match err {
        SystemStatusError::Communication(inner) => describe_transport(&inner),
        other @ SystemStatusError::AuthInvalid => {
            format!("the host answered with an error: {other:?}")
        }
    })
}

fn display_hash(hash: &str) -> String {
    if hash.is_empty() {
        "unknown (the host predates the fingerprint)".to_owned()
    } else {
        hash.to_owned()
    }
}

pub(crate) struct HostsReachable;

#[async_trait]
impl HostCheck for HostsReachable {
    fn id(&self) -> &'static str {
        "database_hosts.reachable"
    }

    fn title(&self) -> &'static str {
        "Reachable, with every offered engine listening"
    }

    fn description(&self) -> &'static str {
        "The host must answer its agent api, and the proxy subsystem of every engine it serves \
         must be listening. A host that is down takes every database on it offline."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Connectivity
    }

    async fn run(
        &self,
        _backend: &Backend,
        host: &BackendDatabaseHost,
    ) -> Result<Vec<IntegrityFinding>, CheckError> {
        let status = match status(host).await {
            Ok(status) => status,
            Err(reason) => {
                return Ok(vec![
                    IntegrityFinding::error(format!(
                        "The database host is not reachable: {reason}"
                    ))
                    .with_detail("maintenance", host.maintenance.to_string()),
                ]);
            }
        };

        let mut findings = vec![
            IntegrityFinding::info("The database host answered")
                .with_detail("version", status.version.clone())
                .with_detail("api", status.api_hash.clone())
                .with_detail("uptime_seconds", status.uptime.to_string())
                .with_detail("instances", status.instance_count.to_string())
                .with_detail("maintenance", host.maintenance.to_string()),
        ];

        for kind in DatabaseType::ALL {
            let offered = host.ports.contains_key(kind);
            let running = status
                .subsystems
                .get(kind.as_str())
                .is_some_and(|subsystem| subsystem.running);

            if offered && !running {
                findings.push(
                    IntegrityFinding::error(format!(
                        "The backend publishes a {kind} port for this host, but its {kind} \
                         subsystem is not listening"
                    ))
                    .with_subject(kind.as_str().to_owned())
                    .with_detail("port", host.port(*kind).to_string()),
                );
            }
        }

        Ok(findings)
    }
}

pub(crate) struct HostsVersion;

#[async_trait]
impl HostCheck for HostsVersion {
    fn id(&self) -> &'static str {
        "database_hosts.version"
    }

    fn title(&self) -> &'static str {
        "Built against the same agent API as the backend"
    }

    fn description(&self) -> &'static str {
        "Both sides carry a fingerprint of the `OpenAPI` document generated from the shared agent \
         service definitions they were compiled from. A host whose fingerprint differs answers a \
         different shape of the api than this backend calls, whatever commit it reports."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Version
    }

    async fn run(
        &self,
        backend: &Backend,
        host: &BackendDatabaseHost,
    ) -> Result<Vec<IntegrityFinding>, CheckError> {
        let Ok(status) = status(host).await else {
            return Err(CheckError::Skipped(
                "The host did not answer, so its api could not be compared".to_owned(),
            ));
        };

        let expected = backend.agent_api_hash();
        if status.api_hash == expected {
            return Ok(Vec::new());
        }

        Ok(vec![
            IntegrityFinding::error(
                "The database host was built against different agent service definitions than \
                 this backend; the two do not agree on the shape of the api",
            )
            .with_detail("host_api", display_hash(&status.api_hash))
            .with_detail("host_commit", status.version)
            .with_detail("backend_api", expected),
        ])
    }
}

pub(crate) struct HostsInstances;

#[async_trait]
impl HostCheck for HostsInstances {
    fn id(&self) -> &'static str {
        "database_hosts.instances"
    }

    fn title(&self) -> &'static str {
        "Database instances exist on both sides"
    }

    fn description(&self) -> &'static str {
        "Every instance the backend has recorded on this host must exist there, and the host must \
         not run instances the backend has forgotten. An orphan instance keeps its container, \
         volume and proxy routes; a missing one leaves a project with a database it cannot reach."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Database
    }

    async fn run(
        &self,
        backend: &Backend,
        host: &BackendDatabaseHost,
    ) -> Result<Vec<IntegrityFinding>, CheckError> {
        let actual = match host.sdk.list_instances().await {
            Ok(instances) => instances,
            Err(ListInstancesError::Communication(inner)) => {
                return Err(CheckError::Skipped(format!(
                    "The host's instance list could not be pulled: {}",
                    describe_transport(&inner)
                )));
            }
            Err(other) => {
                return Ok(vec![IntegrityFinding::error(format!(
                    "The host refused to list its instances: {other:?}"
                ))]);
            }
        };

        let rows = query!(
            r#"SELECT id, project AS "project: ProjectId", display
               FROM database_instances WHERE host = $1 ORDER BY id"#,
            host.id
        )
        .fetch_all(&*backend.database)
        .await?;

        let known: HashMap<Uuid, (String, ProjectId)> = rows
            .into_iter()
            .map(|row| (row.id, (row.display, row.project)))
            .collect();
        let present: HashSet<Uuid> = actual.iter().map(|instance| instance.data.uuid).collect();

        let mut findings = Vec::new();

        for (id, (display, project)) in &known {
            if !present.contains(id) {
                findings.push(
                    IntegrityFinding::error(format!(
                        "Instance {display} is recorded on this host, but the host does not run it"
                    ))
                    .with_subject(id.to_string())
                    .with_detail("project", project.to_string()),
                );
            }
        }

        for instance in actual {
            if !known.contains_key(&instance.data.uuid) {
                findings.push(
                    IntegrityFinding::error(
                        "The host runs an instance the backend has no record of. Its container, \
                         volume and proxy routes are never cleaned up",
                    )
                    .with_subject(instance.data.uuid.to_string())
                    .with_detail("engine", instance.data.database_type.as_str().to_owned())
                    .with_detail("databases", instance.database_count.to_string()),
                );
            }
        }

        Ok(findings)
    }
}
