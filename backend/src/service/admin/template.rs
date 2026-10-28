use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::server::resync::{ServerResyncPreview, ServerResyncResult, ServerResyncStatus};
use crate::service::admin::template::template_admin_service_error::{
    ListTemplateUsageError, PreviewTemplateResyncError, RefreshTemplateCacheError,
    ResyncTemplateError,
};
use crate::service::template::*;
use crate::service::*;
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use sqlx::query;
use std::collections::HashMap;
use tracing::error;
use zelus::service;

define_query_variable!(template "Restrict the preview to servers using this template");

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct TemplateUsageInfo {
    pub(crate) id: String,
    pub(crate) servers: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResyncReport {
    pub(crate) total: usize,
    pub(crate) updated: usize,
    pub(crate) migrated: usize,
    pub(crate) failed: usize,
    pub(crate) restarted: usize,
    pub(crate) servers: Vec<ServerResyncResult>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct TemplateCacheRefreshResult {
    pub(crate) id: String,
    pub(crate) success: bool,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct RefreshTemplateCachePayload {
    pub(crate) template: Option<String>,
}

#[service(path = "/admin/template", tag = "template", no_sdk)]
pub(crate) impl TemplateAdminService for Backend {
    /// Lists every template with the number of servers running it.
    ///
    /// # Permissions
    /// Requires `ManagementPermissions::SERVER_MANAGE`.
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_template_usage(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<TemplateUsageInfo>, _> {
        auth.require::<_, _, ListTemplateUsageError>((), ManagementPermissions::SERVER_MANAGE)?;

        let mut counts: HashMap<String, i64> =
            query!(r#"SELECT template, COUNT(*) AS "servers!" FROM servers GROUP BY template"#)
                .fetch_all(&*self.database)
                .await?
                .into_iter()
                .map(|row| (row.template, row.servers))
                .collect();

        let mut templates: Vec<_> = self
            .templates
            .read()
            .await
            .keys()
            .map(|id| TemplateUsageInfo {
                servers: counts.remove(id).unwrap_or_default(),
                id: id.clone(),
            })
            .collect();

        templates.extend(
            counts
                .into_iter()
                .map(|(id, servers)| TemplateUsageInfo { id, servers }),
        );
        templates.sort_by(|first, second| first.id.cmp(&second.id));

        Ok(templates)
    }

    /// Lists the servers a resync would rebuild, with the template release each
    /// one was last built with (`rel`) and the release it would move to
    /// (`target_rel`).
    ///
    /// Without `template`, every server on the instance is listed. `rel` is empty
    /// for servers built before releases were tracked, `target_rel` for servers
    /// whose template no longer exists.
    ///
    /// # Permissions
    /// Requires `ManagementPermissions::SERVER_MANAGE`.
    #[route("/resync", method = GET, query = [template])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], template::not_found)]
    async fn preview_template_resync(
        &self,
        #[special] auth: Authentication,
        template: Option<String>,
    ) -> Result<Vec<ServerResyncPreview>, _> {
        auth.require::<_, _, PreviewTemplateResyncError>((), ManagementPermissions::SERVER_MANAGE)?;

        if let Some(template) = template.as_deref()
            && !self.templates.read().await.contains_key(template)
        {
            return Err(PreviewTemplateResyncError::TemplateNotFound);
        }

        Ok(self.preview_resync(template.as_deref()).await?)
    }

    /// Regenerates the build output of servers from their template and pushes it
    /// to their nodes, so a fixed template reaches servers that already exist.
    ///
    /// Without `template`, every server on the instance is resynced. Servers are
    /// reported individually — one that cannot be resynced never stops the rest.
    ///
    /// A pushed build only takes effect when a server next starts; `restart`
    /// cycles the servers that are running so it applies immediately.
    ///
    /// # Permissions
    /// Requires `ManagementPermissions::SERVER_MANAGE`.
    #[route("/resync", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], template::not_found)]
    async fn resync_template(
        &self,
        #[special] auth: Authentication,
        template: Option<String>,
        restart: Option<bool>,
    ) -> Result<ResyncReport, _> {
        auth.require::<_, _, ResyncTemplateError>((), ManagementPermissions::SERVER_MANAGE)?;

        if let Some(template) = template.as_deref()
            && !self.templates.read().await.contains_key(template)
        {
            return Err(ResyncTemplateError::TemplateNotFound);
        }

        let servers = self
            .resync_servers(template.as_deref(), restart.unwrap_or_default())
            .await?;

        Ok(ResyncReport {
            total: servers.len(),
            updated: servers
                .iter()
                .filter(|server| server.status.is_success())
                .count(),
            migrated: servers
                .iter()
                .filter(|server| server.status == ServerResyncStatus::Migrated)
                .count(),
            failed: servers
                .iter()
                .filter(|server| !server.status.is_success())
                .count(),
            restarted: servers.iter().filter(|server| server.restarted).count(),
            servers,
        })
    }

    /// Refreshes the cached upstream data of templates, such as their version
    /// lists, instead of waiting for the next scheduled update.
    ///
    /// Without `template`, every template is refreshed. Templates are reported
    /// individually — one that fails to refresh never stops the rest.
    ///
    /// # Permissions
    /// Requires `ManagementPermissions::SERVER_MANAGE`.
    #[route("/cache/refresh", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], template::not_found)]
    async fn refresh_template_cache(
        &self,
        #[special] auth: Authentication,
        payload: RefreshTemplateCachePayload,
    ) -> Result<Vec<TemplateCacheRefreshResult>, _> {
        auth.require::<_, _, RefreshTemplateCacheError>((), ManagementPermissions::SERVER_MANAGE)?;

        let templates: Vec<_> = {
            let templates = self.templates.read().await;
            match payload.template.as_deref() {
                Some(id) => vec![
                    templates
                        .get(id)
                        .cloned()
                        .ok_or(RefreshTemplateCacheError::TemplateNotFound)?,
                ],
                None => templates.values().cloned().collect(),
            }
        };

        let cache = self.cache.clone();
        let mut results = join_all(templates.into_iter().map(move |template| {
            let cache = cache.clone();
            async move {
                let success = template
                    .refresh_cache(cache)
                    .await
                    .inspect_err(|err| {
                        error!(
                            "Failed to refresh cache for template {}: {err:?}",
                            template.id()
                        );
                    })
                    .is_ok();
                TemplateCacheRefreshResult {
                    id: template.id().to_owned(),
                    success,
                }
            }
        }))
        .await;
        results.sort_by(|first, second| first.id.cmp(&second.id));

        Ok(results)
    }
}
