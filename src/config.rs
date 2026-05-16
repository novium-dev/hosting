use core::net::SocketAddr;
use oauth2::{AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use url::Url;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    pub session_lifetime: u64,
    pub auth: AuthConfig,
    pub public_url: Url,
    pub database_url: String,
    pub cache_url: String,
    pub trusted_urls: Vec<Url>,
    #[cfg(feature = "embedded_node")]
    pub daemon: EmbeddedNodeConfig,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthConfig {
    pub providers: HashMap<String, OAuthProviderConfig>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OAuthProviderConfig {
    pub auth_url: AuthUrl,
    pub token_url: TokenUrl,
    pub redirect_url: RedirectUrl,
    pub userinfo_url: Url,
    pub client_id: ClientId,
    pub client_secret: ClientSecret,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmbeddedNodeConfig {
    pub url: Url,
}
