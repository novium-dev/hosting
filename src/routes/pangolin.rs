use crate::config::PangolinConfig;
use crate::routes::{
    ProvisionedRoute, RouteProvider, RouteProviderError, RouteRecord, RouteRequest,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::error;

#[derive(Debug, Serialize)]
struct ResourcePayload<'a> {
    name: &'a str,
    http: bool,
    protocol: &'a str,
    subdomain: &'a str,
    #[serde(rename = "domainId")]
    domain_id: &'a str,
    ssl: bool,
}

#[derive(Debug, Serialize)]
struct TargetPayload<'a> {
    #[serde(rename = "siteId")]
    site_id: i64,
    ip: &'a str,
    port: u16,
    method: &'a str,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
struct ResourceData {
    #[serde(rename = "resourceId")]
    resource_id: i64,
}

#[derive(Debug, Deserialize)]
struct PangolinResponse<T> {
    success: bool,
    data: Option<T>,
}

pub struct PangolinProvider {
    config: PangolinConfig,
    client: Client,
}

impl PangolinProvider {
    pub const fn new(config: PangolinConfig, client: Client) -> Self {
        Self { config, client }
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{path}", self.config.api_url.as_str().trim_end_matches('/'))
    }
}

#[async_trait]
impl RouteProvider for PangolinProvider {
    fn kind(&self) -> &'static str {
        "pangolin"
    }

    fn requires_provider_domain_id(&self) -> bool {
        true
    }

    async fn create_route(
        &self,
        request: &RouteRequest,
    ) -> Result<ProvisionedRoute, RouteProviderError> {
        let Some(ref domain_id) = request.provider_domain_id else {
            error!("The route domain {} has no pangolin domain id", request.domain);
            return Err(RouteProviderError::Unavailable);
        };

        let response = self
            .client
            .put(self.endpoint(&format!("/org/{}/resource", self.config.org_id)))
            .bearer_auth(&self.config.api_key)
            .json(&ResourcePayload {
                name: &request.label,
                http: true,
                protocol: "tcp",
                subdomain: &request.subdomain,
                domain_id,
                ssl: request.https,
            })
            .send()
            .await
            .map_err(|err| {
                error!("Failed to reach Pangolin: {err:?}");
                RouteProviderError::Unavailable
            })?;

        let status = response.status();
        let body = response
            .json::<PangolinResponse<ResourceData>>()
            .await
            .map_err(|err| {
                error!("Failed to decode the Pangolin response: {err:?}");
                RouteProviderError::Rejected
            })?;

        let resource = match body.data {
            Some(data) if body.success => data,
            _ => {
                error!("Pangolin rejected the resource creation with status {status}");
                return Err(RouteProviderError::Rejected);
            }
        };

        let external_ids = vec![resource.resource_id.to_string()];

        let target = self
            .client
            .put(self.endpoint(&format!("/resource/{}/target", resource.resource_id)))
            .bearer_auth(&self.config.api_key)
            .json(&TargetPayload {
                site_id: self.config.site_id,
                ip: &request.target_host,
                port: request.target_port,
                method: if request.https { "https" } else { "http" },
                enabled: true,
            })
            .send()
            .await;

        let target_ok = match target {
            Ok(response) => response.status().is_success(),
            Err(err) => {
                error!("Failed to reach Pangolin: {err:?}");
                false
            }
        };

        if !target_ok {
            self.delete_route(&external_ids).await.ok();
            error!("Pangolin rejected the target creation");
            return Err(RouteProviderError::Rejected);
        }

        Ok(ProvisionedRoute {
            external_ids,
            records: vec![
                RouteRecord {
                    record_type: "RESOURCE".to_owned(),
                    name: request.fqdn(),
                    value: request.url(),
                    priority: None,
                    port: None,
                    ttl: None,
                    proxied: true,
                },
                RouteRecord {
                    record_type: "TARGET".to_owned(),
                    name: request.fqdn(),
                    value: format!("{}:{}", request.target_host, request.target_port),
                    priority: None,
                    port: Some(request.target_port),
                    ttl: None,
                    proxied: true,
                },
            ],
        })
    }

    async fn delete_route(&self, external_ids: &[String]) -> Result<(), RouteProviderError> {
        for id in external_ids {
            let response = self
                .client
                .delete(self.endpoint(&format!("/resource/{id}")))
                .bearer_auth(&self.config.api_key)
                .send()
                .await
                .map_err(|err| {
                    error!("Failed to reach Pangolin: {err:?}");
                    RouteProviderError::Unavailable
                })?;

            if !response.status().is_success()
                && response.status() != reqwest::StatusCode::NOT_FOUND
            {
                error!(
                    "Pangolin rejected the resource deletion with status {}",
                    response.status()
                );
                return Err(RouteProviderError::Rejected);
            }
        }

        Ok(())
    }
}
