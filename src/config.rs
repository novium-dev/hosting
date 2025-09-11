use core::net::SocketAddr;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use url::Url;

#[derive(Serialize, Deserialize, Debug)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    pub session_lifetime: u64,
    #[cfg(feature = "embedded_node")]
    pub daemon: EmbeddedNodeConfig,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct EmbeddedNodeConfig {
    pub url: Url,
}
