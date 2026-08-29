use super::{Check, CheckError};
use crate::state::Agent;
use crate::store::data;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::integrity::{IntegrityCategory, IntegrityFinding};
use database_agent_common::types::DatabaseType;
use zelus::async_trait;

pub struct RouteTable;

#[async_trait]
impl Check for RouteTable {
    fn id(&self) -> &'static str {
        "routes.table"
    }

    fn title(&self) -> &'static str {
        "Every stored user is routable through the proxy"
    }

    fn description(&self) -> &'static str {
        "The proxy resolves an incoming username through the in memory route table. A stored user \
         that is missing from it, or whose routed password no longer matches the store, cannot \
         connect even though the panel offers its credentials."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Connectivity
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let instances = agent.instances.read().await.clone();
        let mut findings = Vec::new();

        for instance in instances {
            let kind = instance.database_type().await;

            for user in data::users(agent.store.read(), instance.uuid).await? {
                let Ok(identifier) =
                    UserIdentifier::from_parts(user.uuid.as_fields().0, &user.username)
                else {
                    continue;
                };

                match agent.routes.find(kind, &identifier) {
                    None => findings.push(
                        IntegrityFinding::error(
                            "A stored user has no entry in the proxy route table".to_owned(),
                        )
                        .with_subject(identifier.to_string())
                        .with_detail("instance", instance.uuid.to_string())
                        .with_detail("engine", kind.as_str().to_owned()),
                    ),
                    Some(credentials) => {
                        if credentials.instance.uuid != instance.uuid {
                            findings.push(
                                IntegrityFinding::error(
                                    "A stored user routes to a different instance than the one it \
                                     belongs to"
                                        .to_owned(),
                                )
                                .with_subject(identifier.to_string())
                                .with_detail("instance", instance.uuid.to_string())
                                .with_detail("routed_to", credentials.instance.uuid.to_string()),
                            );
                        } else if *credentials.password != *user.password {
                            findings.push(
                                IntegrityFinding::error(
                                    "A stored user routes with a password that no longer matches \
                                     the store"
                                        .to_owned(),
                                )
                                .with_subject(identifier.to_string())
                                .with_detail("instance", instance.uuid.to_string()),
                            );
                        }
                    }
                }
            }
        }

        Ok(findings)
    }
}

pub struct Subsystems;

#[async_trait]
impl Check for Subsystems {
    fn id(&self) -> &'static str {
        "routes.subsystems"
    }

    fn title(&self) -> &'static str {
        "Enabled proxy subsystems are listening"
    }

    fn description(&self) -> &'static str {
        "Each enabled engine has one shared listener in front of all its instances. A subsystem \
         that is not running takes every database of that engine offline for clients."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Connectivity
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let snapshot = agent.subsystems.snapshot();
        let mut findings = Vec::new();

        for &kind in DatabaseType::ALL {
            let configured = agent.config.subsystem(kind);
            let status = snapshot.get(kind.as_str());

            let running = status.is_some_and(|status| status.running);

            if configured.enabled && !running {
                findings.push(
                    IntegrityFinding::error(format!(
                        "The {kind} subsystem is enabled but not listening"
                    ))
                    .with_subject(kind.as_str().to_owned())
                    .with_detail("port", configured.port.to_string()),
                );
                continue;
            }

            if !configured.enabled && running {
                findings.push(
                    IntegrityFinding::warning(format!(
                        "The {kind} subsystem is listening although it is disabled in the config"
                    ))
                    .with_subject(kind.as_str().to_owned()),
                );
                continue;
            }

            if configured.enabled {
                let connections = status.map_or(0usize, |status| status.connections.total);
                findings.push(
                    IntegrityFinding::info(format!("The {kind} subsystem is listening"))
                        .with_subject(kind.as_str().to_owned())
                        .with_detail("port", configured.port.to_string())
                        .with_detail("connections", connections.to_string()),
                );
            }
        }

        Ok(findings)
    }
}
