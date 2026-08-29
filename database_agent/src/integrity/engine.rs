use super::{Check, CheckError};
use crate::instance::Instance;
use crate::instance::connection::Connection;
use crate::state::Agent;
use crate::store::data;
use core::str::FromStr as _;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::integrity::{IntegrityCategory, IntegrityFinding};
use database_agent_common::types::{ContainerState, DatabaseType, QueryResult};
use serde_json::Value;
use std::collections::HashSet;
use zelus::async_trait;

const SYSTEM_DATABASES: &[&str] = &[
    "mysql",
    "information_schema",
    "performance_schema",
    "sys",
    "postgres",
    "template0",
    "template1",
    "admin",
    "config",
    "local",
];

async fn online_instances(agent: &Agent) -> Vec<Instance> {
    let mut out = Vec::new();
    for instance in agent.instances.read().await.iter() {
        if instance.container_state().await == ContainerState::Running {
            out.push(instance.clone());
        }
    }
    out
}

fn first_column(result: &QueryResult) -> Vec<String> {
    result
        .rows
        .iter()
        .filter_map(|row| row.first())
        .filter_map(|value| match *value {
            Value::String(ref text) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn mongo_field(result: &QueryResult, array: &str, field: &str) -> Vec<String> {
    result
        .rows
        .iter()
        .filter_map(|row| row.first())
        .filter_map(|value| value.get(array))
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|entry| entry.get(field))
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

async fn engine_databases(
    connection: &Connection,
    kind: DatabaseType,
) -> Result<Option<Vec<String>>, CheckError> {
    let names = match kind {
        DatabaseType::Mariadb => first_column(&connection.query(None, "SHOW DATABASES").await?),
        DatabaseType::Postgres => first_column(
            &connection
                .query(
                    None,
                    "SELECT datname FROM pg_database WHERE NOT datistemplate",
                )
                .await?,
        ),
        DatabaseType::Mongodb => mongo_field(
            &connection.query(None, r#"{"listDatabases": 1}"#).await?,
            "databases",
            "name",
        ),
        DatabaseType::Redis => return Ok(None),
    };

    Ok(Some(
        names
            .into_iter()
            .filter(|name| !SYSTEM_DATABASES.contains(&name.as_str()))
            .collect(),
    ))
}

async fn engine_users(
    connection: &Connection,
    kind: DatabaseType,
) -> Result<Option<Vec<String>>, CheckError> {
    let names = match kind {
        DatabaseType::Mariadb => first_column(
            &connection
                .query(None, "SELECT User FROM mysql.user")
                .await?,
        ),
        DatabaseType::Postgres => first_column(
            &connection
                .query(None, "SELECT rolname FROM pg_roles")
                .await?,
        ),
        DatabaseType::Mongodb => mongo_field(
            &connection
                .query(None, r#"{"usersInfo": {"forAllDBs": true}}"#)
                .await?,
            "users",
            "user",
        ),
        DatabaseType::Redis => return Ok(None),
    };

    Ok(Some(names))
}

pub struct EngineDatabases;

#[async_trait]
impl Check for EngineDatabases {
    fn id(&self) -> &'static str {
        "engine.databases"
    }

    fn title(&self) -> &'static str {
        "Databases exist inside their engine"
    }

    fn description(&self) -> &'static str {
        "Every database the agent has stored must really exist in the engine it belongs to, and \
         the engine must not carry databases the agent does not know about."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Database
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let instances = online_instances(agent).await;
        if instances.is_empty() {
            return Err(CheckError::Skipped(
                "No instance is running on this agent".to_owned(),
            ));
        }

        let mut findings = Vec::new();

        for instance in instances {
            let kind = instance.database_type().await;
            if !kind.has_named_databases() {
                continue;
            }

            let connection = instance.connection().await?;
            let Some(actual) = engine_databases(&connection, kind).await? else {
                continue;
            };
            let actual: HashSet<String> = actual.into_iter().collect();

            let stored = data::databases(agent.store.read(), instance.uuid).await?;
            let mut expected = HashSet::new();

            for database in stored {
                expected.insert(database.name.clone());
                if !actual.contains(&database.name) {
                    findings.push(
                        IntegrityFinding::error(
                            "A stored database does not exist in its engine".to_owned(),
                        )
                        .with_subject(database.name)
                        .with_detail("instance", instance.uuid.to_string())
                        .with_detail("engine", kind.as_str().to_owned()),
                    );
                }
            }

            for name in &actual {
                if !expected.contains(name) {
                    findings.push(
                        IntegrityFinding::warning(
                            "The engine holds a database the agent does not know about".to_owned(),
                        )
                        .with_subject(name.clone())
                        .with_detail("instance", instance.uuid.to_string())
                        .with_detail("engine", kind.as_str().to_owned()),
                    );
                }
            }
        }

        Ok(findings)
    }
}

pub struct EngineUsers;

#[async_trait]
impl Check for EngineUsers {
    fn id(&self) -> &'static str {
        "engine.users"
    }

    fn title(&self) -> &'static str {
        "Database users exist inside their engine"
    }

    fn description(&self) -> &'static str {
        "Every user the agent has stored must have an account in its engine. An account that \
         looks like an agent user but has no stored row can still be connected to and is never \
         rotated or removed."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Database
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let instances = online_instances(agent).await;
        if instances.is_empty() {
            return Err(CheckError::Skipped(
                "No instance is running on this agent".to_owned(),
            ));
        }

        let mut findings = Vec::new();

        for instance in instances {
            let kind = instance.database_type().await;
            let connection = instance.connection().await?;
            let Some(actual) = engine_users(&connection, kind).await? else {
                continue;
            };

            let managed: HashSet<String> = actual
                .into_iter()
                .filter(|name| UserIdentifier::from_str(name).is_ok())
                .collect();

            let stored = data::users(agent.store.read(), instance.uuid).await?;
            let mut expected = HashSet::new();

            for user in stored {
                let Ok(identifier) =
                    UserIdentifier::from_parts(user.uuid.as_fields().0, &user.username)
                else {
                    findings.push(
                        IntegrityFinding::error(
                            "A stored user cannot be turned into a connection identifier; it can \
                             never sign in through the proxy"
                                .to_owned(),
                        )
                        .with_subject(user.username)
                        .with_detail("instance", instance.uuid.to_string()),
                    );
                    continue;
                };

                let name = identifier.to_string();
                expected.insert(name.clone());
                if !managed.contains(&name) {
                    findings.push(
                        IntegrityFinding::error(
                            "A stored user has no account in its engine".to_owned(),
                        )
                        .with_subject(name)
                        .with_detail("instance", instance.uuid.to_string())
                        .with_detail("engine", kind.as_str().to_owned()),
                    );
                }
            }

            for name in &managed {
                if !expected.contains(name) {
                    findings.push(
                        IntegrityFinding::error(
                            "The engine holds an agent shaped account the agent does not know \
                             about"
                                .to_owned(),
                        )
                        .with_subject(name.clone())
                        .with_detail("instance", instance.uuid.to_string())
                        .with_detail("engine", kind.as_str().to_owned()),
                    );
                }
            }
        }

        Ok(findings)
    }
}
