mod service;

use std::collections::HashMap;
use std::ops::Deref;
use std::sync::Arc;
use daemon_common::node::{BackupStorage, ServerStorage};
use daemon_common::service::DaemonServicesURLWithUserKey;
use serde::Serialize;
use uuid::Uuid;
use crate::db::server::ports::NetworkProtocol;

#[derive(Clone)]
pub(crate) struct BackendNode {
    pub(crate) id: u32,
    pub(crate) uuid: Uuid,
    pub(crate) sdk: Arc<dyn DaemonServicesURLWithUserKey + Send + Sync + 'static>,
    pub(crate) display: String,
    pub(crate) default_host: String,
    pub(crate) default_bind: String,
    pub(crate) server_storages: HashMap<String, ServerStorage>,
    pub(crate) backup_storages: HashMap<String, BackupStorage>,
    pub(crate) ports: Vec<NodePortAllocation>,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
pub(crate) struct NodePortAllocation {
    pub(crate) id: u32,
    pub(crate) node: u32,
    pub(crate) protocol: NetworkProtocol,
    pub(crate) start: u16,
    pub(crate) end: u16,
}

impl Deref for BackendNode {
    type Target = dyn DaemonServicesURLWithUserKey + Send + Sync + 'static;

    fn deref(&self) -> &Self::Target {
        self.sdk.deref()
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