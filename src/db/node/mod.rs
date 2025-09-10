use crate::db::server::ports::NetworkProtocol;
use core::ops::Deref;
use daemon_common::node::{BackupStorage, ServerStorage};
use daemon_common::service::DaemonServicesURLWithUserKey;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct BackendNode {
    pub id: u32,
    pub uuid: Uuid,
    pub sdk: Arc<dyn DaemonServicesURLWithUserKey + Send + Sync + 'static>,
    pub display: String,
    pub default_host: String,
    pub default_bind: String,
    pub server_storages: HashMap<String, ServerStorage>,
    pub backup_storages: HashMap<String, BackupStorage>,
    pub ports: Vec<NodePortAllocation>,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
pub struct NodePortAllocation {
    pub id: u32,
    pub node: u32,
    pub protocol: NetworkProtocol,
    pub start: u16,
    pub end: u16,
}

impl Deref for BackendNode {
    type Target = dyn DaemonServicesURLWithUserKey + Send + Sync + 'static;

    fn deref(&self) -> &Self::Target {
        &*self.sdk
    }
}

impl BackendNode {
    pub(crate) fn default_host(&self) -> String {
        self.default_host.clone()
    }

    pub(crate) fn default_bind(&self) -> String {
        self.default_bind.clone()
    }
}

pub struct NodeInfo {
    pub id: u32,
    pub uuid: Uuid,
    pub display: String,

    pub default_host: String,
    pub default_bind: String,
}
