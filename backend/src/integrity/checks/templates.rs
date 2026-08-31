use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::integrity::{Check, CheckError};
use crate::templates::TemplateError;
use daemon_common::integrity::{IntegrityCategory, IntegrityFinding};
use sqlx::query;
use sqlx::types::JsonValue;
use zelus::async_trait;

pub(crate) struct Templates;

#[async_trait]
impl Check for Templates {
    fn id(&self) -> &'static str {
        "templates"
    }

    fn title(&self) -> &'static str {
        "Servers use a template that still exists and still loads"
    }

    fn description(&self) -> &'static str {
        "A server stores the name of its template plus the template's own settings. When the \
         template was removed, or its settings no longer decode against the current template \
         code, the server cannot be rebuilt or restarted until it is resynced."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Configuration
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let rows = query!(
            r#"SELECT
                   id AS "id: ServerId",
                   name,
                   project AS "project: ProjectId",
                   template,
                   template_extra AS "template_extra: JsonValue"
               FROM servers
               ORDER BY id"#
        )
        .fetch_all(&*backend.database)
        .await?;

        let templates = backend.templates.read().await.clone();
        let mut findings = Vec::new();

        for row in rows {
            let subject = format!("{} ({})", row.name, row.id);

            let Some(template) = templates.get(&row.template) else {
                findings.push(
                    IntegrityFinding::error(format!(
                        "Server {} uses the template {}, which this backend does not have",
                        row.name, row.template
                    ))
                    .with_subject(subject)
                    .with_detail("template", row.template)
                    .with_detail("project", row.project.to_string()),
                );
                continue;
            };

            match template
                .extra_to_build_payload(backend.cache.clone(), row.template_extra)
                .await
            {
                Ok(_payload) => {}
                Err(TemplateError::Corrupted) => findings.push(
                    IntegrityFinding::error(format!(
                        "The template settings of server {} no longer decode against template {}. \
                         Resync the template to migrate them",
                        row.name, row.template
                    ))
                    .with_subject(subject)
                    .with_detail("template", row.template)
                    .with_detail("project", row.project.to_string()),
                ),
                Err(err) => findings.push(
                    IntegrityFinding::warning(format!(
                        "The template {} could not be evaluated for server {}: {err:?}",
                        row.template, row.name
                    ))
                    .with_subject(subject)
                    .with_detail("template", row.template)
                    .with_detail("project", row.project.to_string()),
                ),
            }
        }

        Ok(findings)
    }
}
