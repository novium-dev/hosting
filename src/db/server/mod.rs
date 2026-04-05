use crate::db::node::BackendNode;
use crate::define_id;
use crate::templates::TemplateInner;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

pub mod ports;

define_id!(ServerId);

pub struct Server {
    pub node: Arc<BackendNode>,
    pub id: ServerId,
    pub name: String,
    pub node_server_id: u32,
    pub owner: String, // Organization id
    pub template: Arc<dyn TemplateInner + Send + Sync>,
    pub template_extra: Value,
    pub custom_dockerfile: Option<String>,
    pub cpu: Option<f32>,
    pub ram: Option<u32>,
    pub swap: Option<u32>,
    pub disk: Option<u64>,
    pub suspended: bool,
    pub internet_access: bool,

    pub backup_limit: Option<u32>,
}

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub struct ServerInfo {
    pub node: Uuid,
    pub id: ServerId,
    pub name: String,
    pub node_server_id: u32,
    pub owner: String, // Organization id
    pub template: String,
    pub template_extra: Value,
    pub custom_dockerfile: Option<String>,
    pub cpu: Option<f32>,
    pub ram: Option<u32>,
    pub swap: Option<u32>,
    pub disk: Option<u64>,
    pub suspended: bool,
    pub internet_access: bool,

    pub backup_limit: Option<u32>,
}

impl From<&Server> for ServerInfo {
    fn from(value: &Server) -> Self {
        Self {
            node: value.node.id,
            id: value.id,
            name: value.name.clone(),
            node_server_id: value.node_server_id,
            owner: value.owner.clone(),
            template: value.template.id().to_owned(),
            template_extra: value.template_extra.clone(),
            custom_dockerfile: value.custom_dockerfile.clone(),
            cpu: value.cpu,
            ram: value.ram,
            swap: value.swap,
            disk: value.disk,
            suspended: value.suspended,
            internet_access: value.internet_access,
            backup_limit: value.backup_limit,
        }
    }
}
