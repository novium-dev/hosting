use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::server::resync::{ServerResyncResult, ServerResyncStatus};
use crate::service::admin::template::template_admin_service_error::{
    ListTemplateUsageError, ResyncTemplateError,
};
use crate::service::template::*;
use crate::service::*;
use serde::Serialize;
use sqlx::query;
use std::collections::HashMap;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct TemplateUsageInfo {
    pub(crate) id: String,
    /// How many servers on this instance run the template.
    pub(crate) servers: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResyncReport {
    pub(crate) total: usize,
    /// Servers whose node accepted the regenerated build.
    pub(crate) updated: usize,
    /// Of those, how many needed their stored configuration migrated first.
    pub(crate) migrated: usize,
    pub(crate) failed: usize,
    pub(crate) restarted: usize,
    pub(crate) servers: Vec<ServerResyncResult>,
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

        // Templates a server still references but this build no longer knows
        // are worth seeing here, since they can never be resynced.
        templates.extend(
            counts
                .into_iter()
                .map(|(id, servers)| TemplateUsageInfo { id, servers }),
        );
        templates.sort_by(|first, second| first.id.cmp(&second.id));

        Ok(templates)
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
}
