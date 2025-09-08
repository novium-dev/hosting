use std::sync::Arc;
use serde_json::Value;
use crate::db::node::BackendNode;
use crate::define_id;
use crate::templates::TemplateInner;

pub(crate) mod ports;

define_id!(ServerId);

pub struct Server {
    node: Arc<BackendNode>,
    pub id: ServerId,
    name: String,
    pub node_server_id: u32,
    pub owner: u32,
    template: Arc<dyn TemplateInner + Send + Sync>,
    template_extra: Value,
    custom_dockerfile: Option<String>,
    cpu: Option<f32>,
    ram: Option<u32>,
    swap: Option<u32>,
    disk: Option<u64>,
    group: Option<String>,
    suspended: bool,
    internet_access: bool,

    backup_limit: Option<u32>,
}