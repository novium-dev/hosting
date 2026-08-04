use core::net::SocketAddr;
use oauth2::{AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use url::Url;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    pub public_url: Url,
    pub session_lifetime: u64,
    pub auth: AuthConfig,
    pub database_url: String,
    pub cache_url: String,
    #[serde(default)]
    pub frontend_dir: Option<PathBuf>,
    #[serde(default)]
    pub skip_template_cache_update: Option<bool>,
    #[serde(default)]
    pub resources: ResourceConfig,
    #[serde(default)]
    pub routes: RouteConfig,
    #[cfg(feature = "embedded_node")]
    pub daemon: EmbeddedNodeConfig,
}

impl BackendConfig {
    pub fn cookie_secure(&self) -> bool {
        self.public_url.scheme() == "https"
    }

    pub fn resolved_frontend_dir(&self) -> Option<PathBuf> {
        self.frontend_dir
            .clone()
            .or_else(|| std::env::var_os("BACKEND_FRONTEND_DIR").map(PathBuf::from))
    }

    pub fn should_skip_template_cache_update(&self) -> bool {
        self.skip_template_cache_update.unwrap_or_else(|| {
            std::env::var("BACKEND_SKIP_TEMPLATE_CACHE_UPDATE")
                .is_ok_and(|val| val.eq_ignore_ascii_case("1") || val.eq_ignore_ascii_case("true"))
        })
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ResourceConfig {
    #[serde(default)]
    pub curseforge_api_key: Option<String>,
}

impl ResourceConfig {
    pub fn resolved_curseforge_api_key(&self) -> Option<String> {
        self.curseforge_api_key
            .clone()
            .or_else(|| std::env::var("BACKEND_CURSEFORGE_API_KEY").ok())
            .filter(|key| !key.is_empty())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct RouteConfig {
    #[serde(default)]
    pub cloudflare: Option<CloudflareConfig>,
    #[serde(default)]
    pub pangolin: Option<PangolinConfig>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CloudflareConfig {
    pub api_token: String,
    pub zone_id: String,
    #[serde(default)]
    pub ttl: Option<u32>,
    #[serde(default)]
    pub api_url: Option<Url>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PangolinConfig {
    pub api_url: Url,
    pub api_key: String,
    pub org_id: String,
    pub site_id: i64,
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
