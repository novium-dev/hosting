use core::net::SocketAddr;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use url::Url;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    pub auth: AuthConfig,
    pub database_url: String,
    pub cache_url: String,
    pub trusted_urls: Vec<Url>,
    #[cfg(feature = "embedded_node")]
    pub daemon: EmbeddedNodeConfig,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthConfig {
    pub jwks_url: Url,
    pub issuer: String,
    #[serde(default)]
    pub audiences: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmbeddedNodeConfig {
    pub url: Url,
}
