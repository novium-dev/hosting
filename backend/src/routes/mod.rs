pub mod cloudflare;
pub mod pangolin;

use crate::config::RouteConfig;
use crate::routes::cloudflare::CloudflareClient;
use crate::routes::pangolin::PangolinClient;
use lazy_regex::regex_is_match;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteError {
    Unavailable,
    Rejected,
    DomainNotLinked,
    ZoneNotFound,
}

#[derive(
    Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "route_kind", rename_all = "lowercase")]
pub enum RouteKind {
    #[serde(rename = "http")]
    Http,
    #[serde(rename = "tcp")]
    Tcp,
    #[serde(rename = "udp")]
    Udp,
}

impl RouteKind {
    pub const fn srv_protocol(self) -> &'static str {
        match self {
            Self::Udp => "udp",
            Self::Http | Self::Tcp => "tcp",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct RouteRecord {
    pub record_type: String,
    pub name: String,
    pub value: String,
    pub priority: Option<u16>,
    pub port: Option<u16>,
    pub ttl: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct RouteRequest {
    pub domain: String,
    pub subdomain: String,
    pub kind: RouteKind,
    pub service: Option<String>,
    pub zone_id: Option<String>,
    pub pangolin_domain_id: Option<String>,
    pub https: bool,
    pub target_host: String,
    pub target_port: u16,
    pub label: String,
}

impl RouteRequest {
    pub fn fqdn(&self) -> String {
        format!("{}.{}", self.subdomain, self.domain)
    }

    pub fn address(&self) -> String {
        match self.kind {
            RouteKind::Http => {
                let scheme = if self.https { "https" } else { "http" };
                format!("{scheme}://{}", self.fqdn())
            }
            RouteKind::Tcp | RouteKind::Udp => self.fqdn(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RouteHandle<'a> {
    pub kind: RouteKind,
    pub domain: &'a str,
    pub zone_id: Option<&'a str>,
    pub external_ids: &'a [String],
}

#[derive(Debug, Clone)]
pub struct ProvisionedRoute {
    pub external_ids: Vec<String>,
    pub records: Vec<RouteRecord>,
}

pub struct RouteBackends {
    cloudflare: Option<CloudflareClient>,
    pangolin: Option<PangolinClient>,
}

impl RouteBackends {
    pub fn new(config: &RouteConfig, client: &Client) -> Self {
        let cloudflare = config
            .cloudflare
            .clone()
            .map(|config| CloudflareClient::new(config, client.clone()));
        let pangolin = config
            .pangolin
            .clone()
            .map(|config| PangolinClient::new(config, client.clone()));

        info!(
            "Route backends: cloudflare {}, pangolin {}",
            if cloudflare.is_some() {
                "configured"
            } else {
                "missing"
            },
            if pangolin.is_some() {
                "configured"
            } else {
                "missing"
            }
        );

        Self {
            cloudflare,
            pangolin,
        }
    }

    pub const fn supports(&self, kind: RouteKind) -> bool {
        match kind {
            RouteKind::Http => self.pangolin.is_some(),
            RouteKind::Tcp | RouteKind::Udp => self.cloudflare.is_some(),
        }
    }

    pub async fn create(&self, request: &RouteRequest) -> Result<ProvisionedRoute, RouteError> {
        match request.kind {
            RouteKind::Http => {
                self.pangolin
                    .as_ref()
                    .ok_or(RouteError::Unavailable)?
                    .create(request)
                    .await
            }
            RouteKind::Tcp | RouteKind::Udp => {
                self.cloudflare
                    .as_ref()
                    .ok_or(RouteError::Unavailable)?
                    .create(request)
                    .await
            }
        }
    }

    pub async fn delete(&self, handle: RouteHandle<'_>) -> Result<(), RouteError> {
        match handle.kind {
            RouteKind::Http => {
                self.pangolin
                    .as_ref()
                    .ok_or(RouteError::Unavailable)?
                    .delete(handle.external_ids)
                    .await
            }
            RouteKind::Tcp | RouteKind::Udp => {
                let cloudflare = self.cloudflare.as_ref().ok_or(RouteError::Unavailable)?;
                let zone = match handle.zone_id {
                    Some(zone) => zone.to_owned(),
                    None => cloudflare.zone(handle.domain).await?,
                };

                cloudflare.delete(&zone, handle.external_ids).await
            }
        }
    }

    pub async fn zone(&self, domain: &str) -> Result<String, RouteError> {
        self.cloudflare
            .as_ref()
            .ok_or(RouteError::Unavailable)?
            .zone(domain)
            .await
    }
}

pub fn is_valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && regex_is_match!(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", label)
}

pub fn is_valid_domain(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= 253
        && regex_is_match!(
            r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$",
            domain
        )
}

pub fn service_name(name: &str) -> String {
    let mut service = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            service.extend(character.to_lowercase());
            continue;
        }

        if !service.is_empty() && !service.ends_with('-') {
            service.push('-');
        }
    }
    service.trim_end_matches('-').to_owned()
}
