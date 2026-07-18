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
