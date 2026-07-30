//! Pushing a server's current template output back to its node.
//!
//! Templates live in this binary: a fix to one (a corrected Dockerfile, a
//! changed config file, a new environment variable) only reaches a server the
//! next time its build payload is generated and sent. Nothing does that on its
//! own — servers keep running whatever payload they were created with — so this
//! module rebuilds the payload from the template and pushes it, for one server
//! or for every server using a template.

use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::templates::TemplateError;
use futures::StreamExt as _;
use serde::Serialize;
use serde_json::Value;
use sqlx::{query, types::JsonValue};
use tracing::{error, warn};

/// The lifecycle labels a daemon reports for a server that is not stopped.
/// Only those get restarted, so a resync never starts a server nobody asked to
/// run.
const RUNNING_LABELS: [&str; 4] = ["running", "unhealthy", "starting", "restarting"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ServerResyncStatus {
    /// The template output was regenerated and pushed to the node.
    Updated,
    /// Same, but the stored template configuration was missing fields the
    /// template expects today; they were filled in from its defaults first.
    Migrated,
    /// The server's node is not registered on this instance.
    NodeMissing,
    /// The node refused or could not be reached.
    NodeFailure,
    /// The server's template does not exist in this build.
    TemplateMissing,
    /// The template's cache has not been built yet.
    TemplateUnavailable,
    /// The stored configuration is unreadable, even after migration.
    TemplateCorrupted,
    /// The database or the cache failed.
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
    /// Whether the server was restarted so the new build takes effect now.
    pub restarted: bool,
}

/// A server as far as a resync is concerned.
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
    /// Resyncs every server, optionally narrowed to one template.
    ///
    /// Servers are processed with a small amount of concurrency: each one costs
    /// at least one node round trip, and instances have far more servers than
    /// nodes, but hammering a node with every one of its servers at once is not
    /// worth the latency saved.
    pub async fn resync_servers(
        &self,
        template: Option<&str>,
        restart: bool,
    ) -> Result<Vec<ServerResyncResult>, sqlx::Error> {
        /// How many servers are resynced at the same time.
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

    /// Resyncs a single server, reporting why it failed instead of aborting the
    /// run: one broken server must not stop the rest from getting the fix.
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
                // The usual reason a template stops reading its own data is that
                // it gained a field the stored configuration predates, so try
                // once more with the template's current defaults underneath.
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

        // Derived from the template alone, so the ports have to be re-added.
        match self.port_environment(&*self.database, target.id).await {
            Ok(environment) => build.environment.extend(environment),
            Err(err) => {
                error!("Unable to load ports of server {}: {err:?}", target.id);
                return result(ServerResyncStatus::Failure, false);
            }
        }

        // Ports and resources stay untouched: only what the template produces is
        // being replaced here.
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
                // The node already has the new build; losing the migrated
                // configuration only means the next resync migrates again.
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

        // A pushed build only takes effect on the next start, so a running
        // server keeps the old one until it is cycled.
        let running = node
            .server_status(node_server_id)
            .await
            .is_ok_and(|status| RUNNING_LABELS.contains(&status.state.label.as_str()));

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

/// Overlays `current` onto `defaults`, so fields a newer template added appear
/// with their default value while everything the server has configured wins.
///
/// Only objects are merged; a value the server set is never second-guessed.
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
