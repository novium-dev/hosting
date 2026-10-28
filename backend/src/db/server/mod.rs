use crate::db::node::BackendNode;
use crate::db::project::ProjectId;
use crate::define_id;
use crate::templates::{ENV_FILE_ENVIRONMENT, TemplateInner};
use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use serde_json::Value;
use sqlx::{Executor, Postgres, query};
use std::collections::HashMap;
use std::sync::Arc;

pub mod ports;
pub mod provision;
pub mod resources;
pub mod resync;
pub mod schedule;

define_id!(ServerId);

pub struct Server {
    pub node: Arc<BackendNode>,
    pub id: ServerId,
    pub name: String,
    pub node_server_id: u32,
    pub group_id: Option<i32>,
    pub project: ProjectId,
    pub template: Arc<dyn TemplateInner + Send + Sync>,
    pub template_extra: Value,
    pub custom_dockerfile: Option<String>,
    pub custom_environment: HashMap<String, String>,
    pub env_file_enabled: bool,
    pub env_file_path: String,
    pub cpu: Option<f32>,
    pub ram: Option<u32>,
    pub swap: Option<u32>,
    pub disk: Option<u64>,
    pub suspended: bool,
    pub suspension_reason: Option<String>,
    pub internet_access: bool,

    pub backup_limit: Option<u32>,
}

pub struct ServerCustomization<'a> {
    pub server: ServerId,
    pub template: &'a (dyn TemplateInner + Send + Sync),
    pub dockerfile: Option<&'a str>,
    pub environment: &'a HashMap<String, String>,
    pub env_file: Option<&'a str>,
}

impl ServerCustomization<'_> {
    #[must_use]
    pub fn apply(&self, mut build: ServerBuildPayload) -> ServerBuildPayload {
        if self.template.supports_custom_environment() {
            for (key, value) in self.environment {
                build
                    .environment
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }

            if let Some(env_file) = self.env_file {
                build
                    .environment
                    .insert(ENV_FILE_ENVIRONMENT.to_owned(), env_file.to_owned());
            }
        }

        if let Some(dockerfile) = self.dockerfile {
            build.image = ServerBuildImage {
                default_tag: None,
                tag: None,
                parents: vec![build.image],
                args: HashMap::new(),
                dockerfile: dockerfile.to_owned(),
                base: Some(0),
            };
            build.image.tag = Some(format!("custom_{}_{}", self.server, build.image.id()));
        }

        build
    }
}

impl Server {
    #[must_use]
    pub fn customization(&self) -> ServerCustomization<'_> {
        ServerCustomization {
            server: self.id,
            template: &*self.template,
            dockerfile: self.custom_dockerfile.as_deref(),
            environment: &self.custom_environment,
            env_file: self.env_file_enabled.then_some(self.env_file_path.as_str()),
        }
    }
}

pub async fn store_template_rel(
    conn: impl Executor<'_, Database = Postgres>,
    server: ServerId,
    rel: u32,
) -> Result<(), sqlx::Error> {
    query!(
        "UPDATE servers SET template_rel = $1 WHERE id = $2",
        rel.cast_signed(),
        &server
    )
    .execute(conn)
    .await?;
    Ok(())
}
