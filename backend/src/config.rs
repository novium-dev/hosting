use core::net::SocketAddr;
use database_agent_common::types::{DatabaseType, StoredInstanceCreate, VolumeMapping};
use oauth2::{AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use url::Url;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    pub public_url: Url,
    #[serde(default)]
    pub trusted_urls: Vec<Url>,
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
    #[serde(default)]
    pub databases: DatabaseConfig,
    #[cfg(feature = "embedded_node")]
    pub daemon: EmbeddedNodeConfig,
}

impl BackendConfig {
    pub fn cookie_secure(&self) -> bool {
        self.public_url.scheme() == "https"
    }

    pub fn allowed_origins(&self) -> Vec<url::Origin> {
        core::iter::once(self.public_url.origin())
            .chain(self.trusted_urls.iter().map(Url::origin))
            .collect()
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

/// Shape of the instances projects create for themselves. They pick the engine
/// and nothing else, so everything the agent needs comes from here.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct DatabaseConfig {
    #[serde(default)]
    pub defaults: HashMap<DatabaseType, InstanceDefaults>,
}

impl DatabaseConfig {
    pub fn defaults_for(&self, kind: DatabaseType) -> Option<&InstanceDefaults> {
        self.defaults.get(&kind)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InstanceDefaults {
    pub image: String,
    pub image_uid: u32,
    pub image_gid: u32,
    pub socket_path: String,
    pub memory: i64,
    pub swap: i64,
    pub disk: i64,
    pub cpu: i64,
    #[serde(default)]
    pub volumes: BTreeMap<String, String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cmd: Option<Vec<String>>,
}

impl InstanceDefaults {
    pub fn to_create(&self, kind: DatabaseType) -> StoredInstanceCreate {
        StoredInstanceCreate {
            database_type: kind,
            suspended: false,
            memory: self.memory,
            swap: self.swap,
            disk: self.disk,
            io_weight: None,
            cpu: self.cpu,
            image: self.image.clone(),
            image_uid: self.image_uid,
            image_gid: self.image_gid,
            volumes: VolumeMapping(self.volumes.clone()),
            socket_path: self.socket_path.clone(),
            timezone: None,
            env: self.env.clone(),
            cmd: self.cmd.clone(),
        }
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
