use core::net::SocketAddr;
use oauth2::{AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use url::Url;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    /// The public URL the backend (and the served frontend) is reachable at.
    /// Its scheme decides whether the session cookie is marked `Secure`.
    pub public_url: Url,
    pub session_lifetime: u64,
    pub auth: AuthConfig,
    pub database_url: String,
    pub cache_url: String,
    /// Directory containing the built frontend SPA (`index.html` + assets).
    /// When set and present, the backend serves it with an SPA fallback.
    /// Falls back to the `BACKEND_FRONTEND_DIR` environment variable.
    #[serde(default)]
    pub frontend_dir: Option<PathBuf>,
    /// Skip refreshing the template caches (upstream version lists, ...).
    #[serde(default)]
    pub skip_template_cache_update: Option<bool>,
    /// Credentials for the mod/plugin resource providers.
    #[serde(default)]
    pub resources: ResourceConfig,
    #[cfg(feature = "embedded_node")]
    pub daemon: EmbeddedNodeConfig,
}

impl BackendConfig {
    /// Whether session cookies should carry the `Secure` attribute.
    pub fn cookie_secure(&self) -> bool {
        self.public_url.scheme() == "https"
    }

    /// The directory to serve the frontend from, if any (config takes
    /// precedence over the `BACKEND_FRONTEND_DIR` environment variable).
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

/// Provider credentials for the resource browser. Providers without a required
/// credential are always enabled; CurseForge is only offered when a key is
/// configured, since its API rejects unauthenticated requests.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ResourceConfig {
    /// CurseForge Core API key. Falls back to `BACKEND_CURSEFORGE_API_KEY`.
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
