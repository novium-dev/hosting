use crate::config::CloudflareConfig;
use crate::routes::{
    ProvisionedRoute, RouteProvider, RouteProviderError, RouteRecord, RouteRequest,
};
use async_trait::async_trait;
use core::net::IpAddr;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::error;
use url::Url;

const DEFAULT_API: &str = "https://api.cloudflare.com/client/v4/";

const DEFAULT_TTL: u32 = 1;

const SRV_PRIORITY: u16 = 0;

const SRV_WEIGHT: u16 = 0;

pub struct CloudflareProvider {
    config: CloudflareConfig,
    client: Client,
}

#[derive(Debug, Serialize)]
struct AddressRecordPayload<'a> {
    #[serde(rename = "type")]
    record_type: &'a str,
    name: &'a str,
    content: &'a str,
    ttl: u32,
    proxied: bool,
    comment: &'a str,
}

#[derive(Debug, Serialize)]
struct SrvData<'a> {
    priority: u16,
    weight: u16,
    port: u16,
    target: &'a str,
}

#[derive(Debug, Serialize)]
struct SrvRecordPayload<'a> {
    #[serde(rename = "type")]
    record_type: &'a str,
    name: String,
    data: SrvData<'a>,
    ttl: u32,
    comment: &'a str,
}

#[derive(Debug, Deserialize)]
struct CloudflareResult {
    id: String,
}

#[derive(Debug, Deserialize)]
struct CloudflareResponse {
    success: bool,
    result: Option<CloudflareResult>,
}

impl CloudflareProvider {
    pub const fn new(config: CloudflareConfig, client: Client) -> Self {
        Self { config, client }
    }

    fn api(&self) -> Result<Url, RouteProviderError> {
        self.config
            .api_url
            .clone()
            .map_or_else(
                || Url::parse(DEFAULT_API),
                |url| {
                    if url.as_str().ends_with('/') {
                        Ok(url)
                    } else {
                        Url::parse(&format!("{url}/"))
                    }
                },
            )
            .map_err(|err| {
                error!("Invalid Cloudflare api url: {err:?}");
                RouteProviderError::Unavailable
            })
    }

    fn records_url(&self) -> Result<Url, RouteProviderError> {
        self.api()?
            .join(&format!("zones/{}/dns_records", self.config.zone_id))
            .map_err(|err| {
                error!("Invalid Cloudflare zone: {err:?}");
                RouteProviderError::Unavailable
            })
    }

    fn ttl(&self) -> u32 {
        self.config.ttl.unwrap_or(DEFAULT_TTL)
    }

    async fn post_record<P: Serialize + Sync>(&self, payload: &P) -> Result<String, RouteProviderError> {
        let response = self
            .client
            .post(self.records_url()?)
            .bearer_auth(&self.config.api_token)
            .json(payload)
            .send()
            .await
            .map_err(|err| {
                error!("Failed to reach Cloudflare: {err:?}");
                RouteProviderError::Unavailable
            })?;

        let status = response.status();
        let body = response.json::<CloudflareResponse>().await.map_err(|err| {
            error!("Failed to decode the Cloudflare response: {err:?}");
            RouteProviderError::Rejected
        })?;

        match body.result {
            Some(result) if body.success => Ok(result.id),
            _ => {
                error!("Cloudflare rejected the record creation with status {status}");
                Err(RouteProviderError::Rejected)
            }
        }
    }

    fn address_record_type(target: &str) -> &'static str {
        match target.parse::<IpAddr>() {
            Ok(IpAddr::V4(_)) => "A",
            Ok(IpAddr::V6(_)) => "AAAA",
            Err(_) => "CNAME",
        }
    }
}

#[async_trait]
impl RouteProvider for CloudflareProvider {
    fn kind(&self) -> &'static str {
        "cloudflare"
    }

    fn requires_provider_domain_id(&self) -> bool {
        false
    }

    async fn create_route(
        &self,
        request: &RouteRequest,
    ) -> Result<ProvisionedRoute, RouteProviderError> {
        let fqdn = request.fqdn();
        let record_type = Self::address_record_type(&request.target_host);

        let address_id = self
            .post_record(&AddressRecordPayload {
                record_type,
                name: &fqdn,
                content: &request.target_host,
                ttl: self.ttl(),
                proxied: self.config.proxied && request.https,
                comment: &request.label,
            })
            .await?;

        let mut external_ids = vec![address_id];
        let mut records = vec![RouteRecord {
            record_type: record_type.to_owned(),
            name: fqdn.clone(),
            value: request.target_host.clone(),
            priority: None,
            port: None,
            ttl: Some(self.ttl()),
            proxied: self.config.proxied && request.https,
        }];

        if let Some(ref service) = request.srv_service {
            let name = format!("_{service}._tcp.{fqdn}");
            let srv_id = self
                .post_record(&SrvRecordPayload {
                    record_type: "SRV",
                    name: name.clone(),
                    data: SrvData {
                        priority: SRV_PRIORITY,
                        weight: SRV_WEIGHT,
                        port: request.target_port,
                        target: &fqdn,
                    },
                    ttl: self.ttl(),
                    comment: &request.label,
                })
                .await;

            match srv_id {
                Ok(id) => {
                    external_ids.push(id);
                    records.push(RouteRecord {
                        record_type: "SRV".to_owned(),
                        name,
                        value: fqdn,
                        priority: Some(SRV_PRIORITY),
                        port: Some(request.target_port),
                        ttl: Some(self.ttl()),
                        proxied: false,
                    });
                }
                Err(err) => {
                    self.delete_route(&external_ids).await.ok();
                    return Err(err);
                }
            }
        }

        Ok(ProvisionedRoute {
            external_ids,
            records,
        })
    }

    async fn delete_route(&self, external_ids: &[String]) -> Result<(), RouteProviderError> {
        let base = self.records_url()?;

        for id in external_ids {
            let response = self
                .client
                .delete(format!("{base}/{id}"))
                .bearer_auth(&self.config.api_token)
                .send()
                .await
                .map_err(|err| {
                    error!("Failed to reach Cloudflare: {err:?}");
                    RouteProviderError::Unavailable
                })?;

            if !response.status().is_success() && response.status() != reqwest::StatusCode::NOT_FOUND
            {
                error!(
                    "Cloudflare rejected the record deletion with status {}",
                    response.status()
                );
                return Err(RouteProviderError::Rejected);
            }
        }

        Ok(())
    }
}
