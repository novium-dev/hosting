use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::templates::TemplateError;
use futures::StreamExt as _;
use serde::Serialize;
use serde_json::Value;
use sqlx::{query, types::JsonValue};
use tracing::{error, warn};

const RUNNING_LABELS: [&str; 4] = ["running", "unhealthy", "starting", "restarting"];

#[must_use]
pub fn is_running_label(label: &str) -> bool {
    RUNNING_LABELS.contains(&label)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ServerResyncStatus {
    Updated,
    Migrated,
    NodeMissing,
    NodeFailure,
    TemplateMissing,
    TemplateUnavailable,
    TemplateCorrupted,
    Failure,
}

impl ServerResyncStatus {
    #[must_use]
    pub const fn is_success(self) -> bool {
        matches!(self, Self::Updated | Self::Migrated)
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ServerResyncResult {
    pub server: ServerId,
    pub name: String,
    pub project: ProjectId,
    pub template: String,
    pub status: ServerResyncStatus,
    pub restarted: bool,
}

struct ResyncTarget {
    id: ServerId,
    name: String,
    project: ProjectId,
    node: uuid::Uuid,
    node_server_id: i32,
    template: String,
    template_extra: Value,
}

impl Backend {
    pub async fn resync_servers(
        &self,
        template: Option<&str>,
        restart: bool,
    ) -> Result<Vec<ServerResyncResult>, sqlx::Error> {
        const CONCURRENCY: usize = 8;

        let targets = query!(
            r#"SELECT
                id AS "id: ServerId",
                name,
                project AS "project: ProjectId",
                node,
                node_server_id,
                template,
                template_extra AS "template_extra: JsonValue"
             FROM servers
             WHERE $1::varchar IS NULL OR template = $1
             ORDER BY id"#,
            template
        )
        .fetch_all(&*self.database)
        .await
        .inspect_err(|err| error!("Unable to list servers for template resync: {err:?}"))?
        .into_iter()
        .map(|row| ResyncTarget {
            id: row.id,
            name: row.name,
            project: row.project,
            node: row.node,
            node_server_id: row.node_server_id,
            template: row.template,
            template_extra: row.template_extra,
        });

        Ok(
            futures::stream::iter(targets.map(|target| self.resync_server(target, restart)))
                .buffered(CONCURRENCY)
                .collect::<Vec<_>>()
                .await,
        )
    }

    async fn resync_server(&self, target: ResyncTarget, restart: bool) -> ServerResyncResult {
        let result = |status, restarted| ServerResyncResult {
            server: target.id,
            name: target.name.clone(),
            project: target.project,
            template: target.template.clone(),
            status,
            restarted,
        };

        let Some(node) = self.nodes.read().await.get(&target.node).cloned() else {
            warn!(
                "Skipping resync of server {}: node {} is not registered",
                target.id, target.node
            );
            return result(ServerResyncStatus::NodeMissing, false);
        };

        let Some(template) = self.templates.read().await.get(&target.template).cloned() else {
            warn!(
                "Skipping resync of server {}: template {} does not exist",
                target.id, target.template
            );
            return result(ServerResyncStatus::TemplateMissing, false);
        };

        let node_server_id = target.node_server_id.cast_unsigned();

        let (mut build, migrated_extra) = match template
            .extra_to_build_payload(self.cache.clone(), target.template_extra.clone())
            .await
        {
            Ok(build) => (build, None),
            Err(TemplateError::Corrupted) => {
                let defaults = match template.default_extra(self.cache.clone()).await {
                    Ok(defaults) => defaults,
                    Err(err) => {
                        error!(
                            "Unable to load defaults of template {}: {err:?}",
                            target.template
                        );
                        return result(ServerResyncStatus::TemplateUnavailable, false);
                    }
                };

                let migrated = merge_defaults(&defaults, &target.template_extra);
                match template
                    .extra_to_build_payload(self.cache.clone(), migrated.clone())
                    .await
                {
                    Ok(build) => (build, Some(migrated)),
                    Err(err) => {
                        error!(
                            "Unable to rebuild server {} even after migration: {err:?}",
                            target.id
                        );
                        return result(ServerResyncStatus::TemplateCorrupted, false);
                    }
                }
            }
            Err(TemplateError::Unavailable) => {
                return result(ServerResyncStatus::TemplateUnavailable, false);
            }
            Err(TemplateError::Redis(err)) => {
                error!("Unable to rebuild server {}: {err:?}", target.id);
                return result(ServerResyncStatus::Failure, false);
            }
        };

        match self.port_environment(&*self.database, target.id).await {
            Ok(environment) => build.environment.extend(environment),
            Err(err) => {
                error!("Unable to load ports of server {}: {err:?}", target.id);
                return result(ServerResyncStatus::Failure, false);
            }
        }

        if let Err(err) = self
            .license_apply(target.id, template.licenses(), &mut build)
            .await
        {
            error!("Unable to load licenses of server {}: {err:?}", target.id);
            return result(ServerResyncStatus::Failure, false);
        }

        if let Err(err) = node
            .update_server(node_server_id, None, Some(build), None, None)
            .await
        {
            error!("Node refused the resync of server {}: {err:?}", target.id);
            return result(ServerResyncStatus::NodeFailure, false);
        }

        let status = if let Some(extra) = migrated_extra {
            if let Err(err) = query!(
                "UPDATE servers SET template_extra = $1 WHERE id = $2",
                extra,
                &target.id
            )
            .execute(&*self.database)
            .await
            {
                error!(
                    "Unable to store migrated configuration of server {}: {err:?}",
                    target.id
                );
            }
            ServerResyncStatus::Migrated
        } else {
            ServerResyncStatus::Updated
        };

        if !restart {
            return result(status, false);
        }

        let running = node
            .server_status(node_server_id)
            .await
            .is_ok_and(|status| is_running_label(&status.state.label));

        if !running {
            return result(status, false);
        }

        match node.restart_server(node_server_id).await {
            Ok(()) => result(status, true),
            Err(err) => {
                error!(
                    "Unable to restart server {} after resync: {err:?}",
                    target.id
                );
                result(status, false)
            }
        }
    }
}

fn merge_defaults(defaults: &Value, current: &Value) -> Value {
    match (defaults, current) {
        (Value::Object(defaults), Value::Object(current)) => {
            let mut merged = defaults.clone();
            for (key, value) in current {
                let merged_value = defaults
                    .get(key)
                    .map_or_else(|| value.clone(), |default| merge_defaults(default, value));
                merged.insert(key.clone(), merged_value);
            }
            Value::Object(merged)
        }
        (_, current) => current.clone(),
    }
}
