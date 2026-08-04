use crate::config::PangolinConfig;
use crate::routes::{ProvisionedRoute, RouteError, RouteRecord, RouteRequest};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::error;

#[derive(Debug, Serialize)]
struct ResourcePayload<'a> {
    name: &'a str,
    subdomain: &'a str,
    #[serde(rename = "domainId")]
    domain_id: &'a str,
    mode: &'a str,
}

#[derive(Debug, Serialize)]
struct TargetPayload<'a> {
    #[serde(rename = "siteId")]
    site_id: i64,
    ip: &'a str,
    port: u16,
    mode: &'a str,
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

pub struct PangolinClient {
    config: PangolinConfig,
    client: Client,
}

impl PangolinClient {
    pub const fn new(config: PangolinConfig, client: Client) -> Self {
        Self { config, client }
    }

    fn endpoint(&self, path: &str) -> String {
        format!(
            "{}{path}",
            self.config.api_url.as_str().trim_end_matches('/')
        )
    }

    pub async fn create(&self, request: &RouteRequest) -> Result<ProvisionedRoute, RouteError> {
        let Some(ref domain_id) = request.pangolin_domain_id else {
            return Err(RouteError::DomainNotLinked);
        };

        let response = self
            .client
            .put(self.endpoint(&format!("/org/{}/public-resource", self.config.org_id)))
            .bearer_auth(&self.config.api_key)
            .json(&ResourcePayload {
                name: &request.label,
                subdomain: &request.subdomain,
                domain_id,
                mode: "http",
            })
            .send()
            .await
            .map_err(|err| {
                error!("Failed to reach Pangolin: {err:?}");
                RouteError::Unavailable
            })?;

        let status = response.status();
        let body = response
            .json::<PangolinResponse<ResourceData>>()
            .await
            .map_err(|err| {
                error!("Failed to decode the Pangolin response: {err:?}");
                RouteError::Rejected
            })?;

        let resource = match body.data {
            Some(data) if body.success => data,
            _ => {
                error!("Pangolin rejected the resource creation with status {status}");
                return Err(RouteError::Rejected);
            }
        };

        let external_ids = vec![resource.resource_id.to_string()];

        let target = self
            .client
            .put(self.endpoint(&format!("/public-resource/{}/target", resource.resource_id)))
            .bearer_auth(&self.config.api_key)
            .json(&TargetPayload {
                site_id: self.config.site_id,
                ip: &request.target_host,
                port: request.target_port,
                mode: "http",
                method: "http",
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
            if let Err(cleanup) = self.delete(&external_ids).await {
                error!("Unable to roll back the Pangolin resource: {cleanup:?}");
            }
            error!("Pangolin rejected the target creation");
            return Err(RouteError::Rejected);
        }

        Ok(ProvisionedRoute {
            external_ids,
            records: vec![
                RouteRecord {
                    record_type: "RESOURCE".to_owned(),
                    name: request.fqdn(),
                    value: request.address(),
                    priority: None,
                    port: None,
                    ttl: None,
                },
                RouteRecord {
                    record_type: "TARGET".to_owned(),
                    name: request.fqdn(),
                    value: format!("{}:{}", request.target_host, request.target_port),
                    priority: None,
                    port: Some(request.target_port),
                    ttl: None,
                },
            ],
        })
    }

    pub async fn delete(&self, external_ids: &[String]) -> Result<(), RouteError> {
        for id in external_ids {
            let response = self
                .client
                .delete(self.endpoint(&format!("/public-resource/{id}")))
                .bearer_auth(&self.config.api_key)
                .send()
                .await
                .map_err(|err| {
                    error!("Failed to reach Pangolin: {err:?}");
                    RouteError::Unavailable
                })?;

            if !response.status().is_success()
                && response.status() != reqwest::StatusCode::NOT_FOUND
            {
                error!(
                    "Pangolin rejected the resource deletion with status {}",
                    response.status()
                );
                return Err(RouteError::Rejected);
            }
        }

        Ok(())
    }
}
