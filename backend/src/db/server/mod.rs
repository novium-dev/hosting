use crate::db::node::BackendNode;
use crate::db::project::ProjectId;
use crate::define_id;
use crate::templates::TemplateInner;
use serde_json::Value;
use std::sync::Arc;

pub mod ports;
pub mod resources;
pub mod resync;
pub mod schedule;

define_id!(ServerId);

pub struct Server {
    pub node: Arc<BackendNode>,
    pub id: ServerId,
    pub name: String,
    pub node_server_id: u32,
    pub project: ProjectId,
    pub template: Arc<dyn TemplateInner + Send + Sync>,
    pub template_extra: Value,
    pub custom_dockerfile: Option<String>,
    pub cpu: Option<f32>,
    pub ram: Option<u32>,
    pub swap: Option<u32>,
    pub disk: Option<u64>,
    pub suspended: bool,
    pub suspension_reason: Option<String>,
    pub internet_access: bool,

    pub backup_limit: Option<u32>,
}
