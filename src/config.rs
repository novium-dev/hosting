use core::net::SocketAddr;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use url::Url;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    pub session_lifetime: u64,
    pub auth: AuthConfig,
    pub public_url: Url,
    #[cfg(feature = "embedded_node")]
    pub daemon: EmbeddedNodeConfig,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthConfig {
    pub url: Url,
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmbeddedNodeConfig {
    pub url: Url,
}
