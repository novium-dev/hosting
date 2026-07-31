pub mod cloudflare;
#[cfg(debug_assertions)]
pub mod local;
pub mod pangolin;

use crate::config::{RouteConfig, RouteProviderConfig};
use crate::routes::cloudflare::CloudflareProvider;
#[cfg(debug_assertions)]
use crate::routes::local::LocalProvider;
use crate::routes::pangolin::PangolinProvider;
use async_trait::async_trait;
use lazy_regex::regex_is_match;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::warn;

pub type RouteProviders = HashMap<String, Arc<dyn RouteProvider + Send + Sync>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteProviderError {
    Unavailable,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct RouteRecord {
    pub record_type: String,
    pub name: String,
    pub value: String,
    pub priority: Option<u16>,
    pub port: Option<u16>,
    pub ttl: Option<u32>,
    pub proxied: bool,
}

#[derive(Debug, Clone)]
pub struct RouteRequest {
    pub domain: String,
    pub provider_domain_id: Option<String>,
    pub srv_service: Option<String>,
    pub subdomain: String,
    pub https: bool,
    pub target_host: String,
    pub target_port: u16,
    pub label: String,
}

impl RouteRequest {
    pub fn fqdn(&self) -> String {
        if self.subdomain.is_empty() {
            self.domain.clone()
        } else {
            format!("{}.{}", self.subdomain, self.domain)
        }
    }

    pub fn url(&self) -> String {
        let scheme = if self.https { "https" } else { "http" };
        format!("{scheme}://{}", self.fqdn())
    }
}

#[derive(Debug, Clone)]
pub struct ProvisionedRoute {
    pub external_ids: Vec<String>,
    pub records: Vec<RouteRecord>,
}

#[async_trait]
pub trait RouteProvider {
    fn kind(&self) -> &'static str;

    fn requires_provider_domain_id(&self) -> bool;

    async fn create_route(
        &self,
        request: &RouteRequest,
    ) -> Result<ProvisionedRoute, RouteProviderError>;

    async fn delete_route(&self, external_ids: &[String]) -> Result<(), RouteProviderError>;
}

pub fn load_providers(config: &RouteConfig, client: &Client) -> RouteProviders {
    let mut providers = RouteProviders::new();

    for (name, provider) in &config.providers {
        let provider: Arc<dyn RouteProvider + Send + Sync> = match *provider {
            RouteProviderConfig::Cloudflare(ref config) => {
                Arc::new(CloudflareProvider::new(config.clone(), client.clone()))
            }
            RouteProviderConfig::Pangolin(ref config) => {
                Arc::new(PangolinProvider::new(config.clone(), client.clone()))
            }
            RouteProviderConfig::Local(ref config) => {
                #[cfg(debug_assertions)]
                {
                    warn!("Route provider {name} is a local test provider");
                    Arc::new(LocalProvider::new(config.clone()))
                }
                #[cfg(not(debug_assertions))]
                {
                    let _ = config;
                    warn!(
                        "Route provider {name} is a local test provider and stays disabled in release builds"
                    );
                    continue;
                }
            }
        };

        providers.insert(name.clone(), provider);
    }

    providers
}

pub fn is_valid_subdomain(subdomain: &str) -> bool {
    !subdomain.is_empty()
        && subdomain.len() <= 63
        && regex_is_match!(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", subdomain)
}

pub fn is_valid_domain(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= 253
        && regex_is_match!(
            r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$",
            domain
        )
}
