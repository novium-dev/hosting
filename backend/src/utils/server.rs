use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::{Server, ServerId};
use crate::service::error_node_failure::FromNodeFailure;
use crate::service::error_server_not_found::FromServerNotFound;
use crate::service::error_server_unavailable::FromServerUnavailable;
use daemon_common::service::server::server_service_error::ExecServerError;
use sqlx::{Executor, Postgres, query, types::JsonValue};
use std::collections::HashMap;
use tracing::{error, warn};

const PORT_ENVIRONMENT_PREFIX: &str = "NOVIUM_PORT_";

pub fn rcon_command(command: impl IntoIterator<Item = String>) -> Vec<String> {
    vec![
        "rcon".to_owned(),
        "-H".to_owned(),
        "::1".to_owned(),
        "-p".to_owned(),
        "25575".to_owned(),
        "-P".to_owned(),
        "_".to_owned(),
        "-m".to_owned(),
        "--".to_owned(),
    ]
    .into_iter()
    .chain(command)
    .collect()
}

pub fn port_environment_key(name: &str) -> String {
    let mut key = String::with_capacity(PORT_ENVIRONMENT_PREFIX.len().saturating_add(name.len()));
    key.push_str(PORT_ENVIRONMENT_PREFIX);
    key.extend(name.chars().map(|character| {
        if character.is_ascii_alphanumeric() {
            character.to_ascii_uppercase()
        } else {
            '_'
        }
    }));
    key
}

impl Backend {
    pub async fn port_environment(
        &self,
        conn: impl Executor<'_, Database = Postgres>,
        server_id: ServerId,
    ) -> Result<HashMap<String, String>, sqlx::Error> {
        Ok(query!(
            "SELECT name, internal_port FROM server_ports WHERE server = $1",
            &server_id
        )
        .fetch_all(conn)
        .await?
        .into_iter()
        .map(|row| {
            (
                port_environment_key(&row.name),
                row.internal_port.to_string(),
            )
        })
        .collect())
    }

    pub async fn resolve_server(
        &self,
        conn: impl Executor<'_, Database = Postgres>,
        id: ServerId,
    ) -> Result<Option<Server>, sqlx::Error> {
        match query!(
            r#"SELECT
                        id AS "id: ServerId",
                        node,
                        node_server_id,
                        project AS "project: ProjectId",
                        name,
                        suspended AS "suspended: bool",
                        suspension_reason,
                        custom_dockerfile,
                        custom_startup,
                        custom_environment AS "custom_environment: JsonValue",
                        internet_access AS "internet_access: bool",
                        cpu,
                        ram,
                        swap,
                        disk,
                        backup_limit,
                        template,
                        template_extra AS "template_extra: JsonValue"
                      FROM servers WHERE id = $1"#,
            &id
        )
        .fetch_optional(conn)
        .await?
        {
            Some(server) => {
                let nodes = self.nodes.read().await;
                let Some(node) = nodes.get(&server.node).cloned() else {
                    warn!(
                        "Found server whose node is not in the nodes cache: {}, node: {}",
                        server.id, server.node
                    );
                    return Ok(None);
                };
                drop(nodes);

                let Some(template) = self.templates.read().await.get(&server.template).cloned()
                else {
                    warn!(
                        "Found server whose template is not registered: {}, template: {}",
                        server.id, server.template
                    );
                    return Ok(None);
                };

                Ok(Some(Server {
                    id: server.id,
                    name: server.name,
                    suspended: server.suspended,
                    suspension_reason: server.suspension_reason,
                    custom_dockerfile: server.custom_dockerfile,
                    custom_startup: server.custom_startup,
                    custom_environment: serde_json::from_value(server.custom_environment)
                        .unwrap_or_else(|err| {
                            warn!(
                                "Found server whose custom environment is unreadable: {}: {err:?}",
                                server.id
                            );
                            HashMap::new()
                        }),
                    internet_access: server.internet_access,

                    project: server.project,

                    node,
                    node_server_id: server.node_server_id.cast_unsigned(),

                    template,
                    template_extra: server.template_extra,

                    cpu: server.cpu,
                    ram: server.ram.map(i32::cast_unsigned),
                    swap: server.swap.map(i32::cast_unsigned),
                    disk: server.disk.map(i64::cast_unsigned),

                    backup_limit: server.backup_limit.map(i32::cast_unsigned),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn execute_rcon<
        E: From<sqlx::Error> + FromServerNotFound + FromNodeFailure + FromServerUnavailable,
    >(
        &self,
        server_id: ServerId,
        command: Vec<String>,
    ) -> Result<(), E> {
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or_else(<E as FromServerNotFound>::from)?;

        server
            .node
            .exec_server(server.node_server_id, rcon_command(command))
            .await
            .map_err(|err| match err {
                ExecServerError::Communication(_) => {
                    error!("Failed to request server command executing: {:?}", err);
                    <E as FromNodeFailure>::from()
                }
                ExecServerError::AuthInvalid | ExecServerError::SqlFailure => {
                    error!("Failed to execute command in server: {:?}", err);
                    <E as FromNodeFailure>::from()
                }
                ExecServerError::ServerNotFound => <E as FromServerNotFound>::from(),
                ExecServerError::ServerMutexLocked => <E as FromServerUnavailable>::from(),
            })
    }
}
