use super::{Check, CheckError};
use crate::instance::docker::SERVICE_LABEL;
use crate::state::Agent;
use bollard::query_parameters::ListContainersOptions;
use core::str::FromStr as _;
use database_agent_common::integrity::{IntegrityCategory, IntegrityFinding};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use zelus::async_trait;

pub struct DockerReachable;

#[async_trait]
impl Check for DockerReachable {
    fn id(&self) -> &'static str {
        "docker.reachable"
    }

    fn title(&self) -> &'static str {
        "Container engine reachable"
    }

    fn description(&self) -> &'static str {
        "Pings the Docker daemon the agent runs its database instances on."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Docker
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        match agent.docker.ping().await {
            Ok(version) => Ok(vec![
                IntegrityFinding::info("The container engine responded to a ping".to_owned())
                    .with_detail("response", version),
            ]),
            Err(err) => Ok(vec![IntegrityFinding::error(format!(
                "The container engine did not respond: {err}"
            ))]),
        }
    }
}

pub struct DockerContainers;

#[async_trait]
impl Check for DockerContainers {
    fn id(&self) -> &'static str {
        "docker.containers"
    }

    fn title(&self) -> &'static str {
        "Instance containers match the store"
    }

    fn description(&self) -> &'static str {
        "Every instance in the agent store must have its container, and every container labelled \
         as belonging to this agent must have an instance. A leftover container keeps its data \
         volume and socket bind mounted."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Docker
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let stored: HashSet<Uuid> = agent
            .instances
            .read()
            .await
            .iter()
            .map(|instance| instance.uuid)
            .collect();

        let containers = agent
            .docker
            .list_containers(Some(ListContainersOptions {
                all: true,
                filters: Some(HashMap::from([(
                    "label".to_owned(),
                    vec![format!("Service={SERVICE_LABEL}")],
                )])),
                ..ListContainersOptions::default()
            }))
            .await?;

        let mut present = HashSet::new();
        let mut findings = Vec::new();

        for container in containers {
            let names = container.names.unwrap_or_default();
            let uuid = names.iter().find_map(|name| {
                Uuid::from_str(name.strip_prefix('/').unwrap_or(name.as_str())).ok()
            });

            match uuid {
                Some(uuid) => {
                    present.insert(uuid);
                    if !stored.contains(&uuid) {
                        findings.push(
                            IntegrityFinding::error(
                                "A container of this agent has no instance in the store".to_owned(),
                            )
                            .with_subject(uuid.to_string())
                            .with_detail(
                                "state",
                                container.state.map_or_else(
                                    || "unknown".to_owned(),
                                    |state| format!("{state:?}"),
                                ),
                            ),
                        );
                    }
                }
                None => findings.push(
                    IntegrityFinding::warning(
                        "A container of this agent is not named after an instance uuid".to_owned(),
                    )
                    .with_subject(names.join(", ")),
                ),
            }
        }

        for uuid in &stored {
            if !present.contains(uuid) {
                findings.push(
                    IntegrityFinding::error(
                        "An instance in the store has no container; it cannot be started"
                            .to_owned(),
                    )
                    .with_subject(uuid.to_string()),
                );
            }
        }

        Ok(findings)
    }
}
