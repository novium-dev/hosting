use super::{Check, CheckError};
use crate::state::Agent;
use core::str::FromStr as _;
use database_agent_common::integrity::{IntegrityCategory, IntegrityFinding};
use database_agent_common::types::ContainerState;
use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::Path;
use tokio::fs;
use uuid::Uuid;
use zelus::async_trait;

pub struct InstanceState;

#[async_trait]
impl Check for InstanceState {
    fn id(&self) -> &'static str {
        "instances.state"
    }

    fn title(&self) -> &'static str {
        "Instances run in the state the store expects"
    }

    fn description(&self) -> &'static str {
        "A suspended instance must not be running, and an instance that is not suspended should \
         be. Either way round the panel shows a state the engine does not actually have."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Configuration
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let instances = agent.instances.read().await.clone();
        let mut findings = Vec::new();

        for instance in instances {
            let suspended = instance.is_suspended().await;
            let state = instance.container_state().await;
            let kind = instance.database_type().await;

            let finding = match (suspended, state) {
                (true, ContainerState::Running | ContainerState::Starting) => {
                    Some(IntegrityFinding::error(
                        "The instance is suspended but its container is still running",
                    ))
                }
                (false, ContainerState::Offline) => Some(IntegrityFinding::warning(
                    "The instance is not suspended but its container is offline; every database \
                     on it is unreachable",
                )),
                _ => None,
            };

            if let Some(finding) = finding {
                findings.push(
                    finding
                        .with_subject(instance.uuid.to_string())
                        .with_detail("engine", kind.as_str().to_owned())
                        .with_detail("state", format!("{state:?}"))
                        .with_detail("suspended", suspended.to_string()),
                );
            }

            let auth_error = instance.backend_auth_error.read().await.clone();
            if let Some(error) = auth_error {
                findings.push(
                    IntegrityFinding::error(format!(
                        "The agent cannot authenticate against this instance: {error}"
                    ))
                    .with_subject(instance.uuid.to_string())
                    .with_detail("engine", kind.as_str().to_owned()),
                );
            }
        }

        Ok(findings)
    }
}

pub struct InstanceDirectories;

#[async_trait]
impl Check for InstanceDirectories {
    fn id(&self) -> &'static str {
        "instances.directories"
    }

    fn title(&self) -> &'static str {
        "Instance data and socket directories match the store"
    }

    fn description(&self) -> &'static str {
        "Each instance owns one data and one socket directory named after its uuid. A directory \
         whose instance was deleted still holds that database's files, and a missing one means \
         the instance cannot start."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Storage
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let stored: HashSet<Uuid> = agent
            .instances
            .read()
            .await
            .iter()
            .map(|instance| instance.uuid)
            .collect();

        let mut findings = Vec::new();

        for (label, root) in [
            ("data", agent.config.data_dir.as_path()),
            ("socket", agent.config.socket_dir.as_path()),
        ] {
            scan_root(&mut findings, label, root, &stored).await?;
        }

        for uuid in &stored {
            for (label, path) in [
                ("data", agent.config.data_dir(*uuid)),
                ("socket", agent.config.socket_dir(*uuid)),
            ] {
                if fs::symlink_metadata(&path).await.is_err() {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The {label} directory of an instance is missing"
                        ))
                        .with_subject(path.to_string_lossy().into_owned())
                        .with_detail("instance", uuid.to_string()),
                    );
                }
            }
        }

        Ok(findings)
    }
}

async fn scan_root(
    findings: &mut Vec<IntegrityFinding>,
    label: &str,
    root: &Path,
    stored: &HashSet<Uuid>,
) -> Result<(), CheckError> {
    let mut read_dir = match fs::read_dir(root).await {
        Ok(read_dir) => read_dir,
        Err(err) if err.kind() == ErrorKind::NotFound => {
            findings.push(
                IntegrityFinding::error(format!("The {label} root directory does not exist"))
                    .with_subject(root.to_string_lossy().into_owned()),
            );
            return Ok(());
        }
        Err(err) => return Err(CheckError::Failed(format!("io error: {err}"))),
    };

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|err| CheckError::Failed(format!("io error: {err}")))?
    {
        if !entry
            .metadata()
            .await
            .map_err(|err| CheckError::Failed(format!("io error: {err}")))?
            .is_dir()
        {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let subject = entry.path().to_string_lossy().into_owned();

        let Ok(uuid) = Uuid::from_str(&name) else {
            findings.push(
                IntegrityFinding::warning(format!(
                    "The {label} root holds a directory that is not named after an instance uuid"
                ))
                .with_subject(subject),
            );
            continue;
        };

        if !stored.contains(&uuid) {
            findings.push(
                IntegrityFinding::warning(format!(
                    "The {label} directory of instance {uuid} is left over; the instance is not \
                     in the store"
                ))
                .with_subject(subject)
                .with_detail("instance", uuid.to_string()),
            );
        }
    }

    Ok(())
}
