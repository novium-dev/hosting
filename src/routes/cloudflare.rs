use crate::config::CloudflareConfig;
use crate::routes::{ProvisionedRoute, RouteError, RouteRecord, RouteRequest, service_name};
use core::net::IpAddr;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;
use tracing::error;
use url::Url;

const DEFAULT_API: &str = "https://api.cloudflare.com/client/v4/";

const DEFAULT_TTL: u32 = 1;

const SRV_PRIORITY: u16 = 0;

const SRV_WEIGHT: u16 = 0;

pub struct CloudflareClient {
    config: CloudflareConfig,
    client: Client,
    zones: RwLock<HashMap<String, String>>,
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
    name: &'a str,
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

#[derive(Debug, Deserialize)]
struct CloudflareZonesResponse {
    success: bool,
    result: Option<Vec<CloudflareResult>>,
}

impl CloudflareClient {
    pub fn new(config: CloudflareConfig, client: Client) -> Self {
        Self {
            config,
            client,
            zones: RwLock::new(HashMap::new()),
        }
    }

    fn api(&self) -> Result<Url, RouteError> {
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
                RouteError::Unavailable
            })
    }

    fn records_url(&self, zone: &str) -> Result<Url, RouteError> {
        self.api()?
            .join(&format!("zones/{zone}/dns_records"))
            .map_err(|err| {
                error!("Invalid Cloudflare zone: {err:?}");
                RouteError::Unavailable
            })
    }

    fn ttl(&self) -> u32 {
        self.config.ttl.unwrap_or(DEFAULT_TTL)
    }

    /// Looks the zone of a domain up by name, keeping resolved zones in memory.
    pub async fn zone(&self, domain: &str) -> Result<String, RouteError> {
        if let Some(zone) = self.zones.read().await.get(domain) {
            return Ok(zone.clone());
        }

        let mut url = self.api()?.join("zones").map_err(|err| {
            error!("Invalid Cloudflare api url: {err:?}");
            RouteError::Unavailable
        })?;
        url.query_pairs_mut().append_pair("name", domain);

        let response = self
            .client
            .get(url)
            .bearer_auth(&self.config.api_token)
            .send()
            .await
            .map_err(|err| {
                error!("Failed to reach Cloudflare: {err:?}");
                RouteError::Unavailable
            })?;

        let status = response.status();
        let body = response
            .json::<CloudflareZonesResponse>()
            .await
            .map_err(|err| {
                error!("Failed to decode the Cloudflare zone response: {err:?}");
                RouteError::Rejected
            })?;

        if !body.success {
            error!("Cloudflare rejected the zone lookup with status {status}");
            return Err(RouteError::Rejected);
        }

        let Some(zone) = body
            .result
            .and_then(|zones| zones.into_iter().next())
            .map(|zone| zone.id)
        else {
            return Err(RouteError::ZoneNotFound);
        };

        self.zones
            .write()
            .await
            .insert(domain.to_owned(), zone.clone());

        Ok(zone)
    }

    async fn post_record<P: Serialize + Sync>(
        &self,
        zone: &str,
        payload: &P,
    ) -> Result<String, RouteError> {
        let response = self
            .client
            .post(self.records_url(zone)?)
            .bearer_auth(&self.config.api_token)
            .json(payload)
            .send()
            .await
            .map_err(|err| {
                error!("Failed to reach Cloudflare: {err:?}");
                RouteError::Unavailable
            })?;

        let status = response.status();
        let body = response.json::<CloudflareResponse>().await.map_err(|err| {
            error!("Failed to decode the Cloudflare response: {err:?}");
            RouteError::Rejected
        })?;

        match body.result {
            Some(result) if body.success => Ok(result.id),
            _ => {
                error!("Cloudflare rejected the record creation with status {status}");
                Err(RouteError::Rejected)
            }
        }
    }

    pub async fn create(&self, request: &RouteRequest) -> Result<ProvisionedRoute, RouteError> {
        let zone = match request.zone_id {
            Some(ref zone) => zone.clone(),
            None => self.zone(&request.domain).await?,
        };

        let fqdn = request.fqdn();
        let service = request
            .service
            .clone()
            .unwrap_or_else(|| service_name(&request.label));
        let protocol = request.kind.srv_protocol();

        let mut external_ids = Vec::new();
        let mut records = Vec::new();

        let srv_target = match request.target_host.parse::<IpAddr>() {
            Ok(address) => {
                let record_type = if address.is_ipv4() { "A" } else { "AAAA" };
                let id = self
                    .post_record(
                        &zone,
                        &AddressRecordPayload {
                            record_type,
                            name: &fqdn,
                            content: &request.target_host,
                            ttl: self.ttl(),
                            proxied: false,
                            comment: &request.label,
                        },
                    )
                    .await?;

                external_ids.push(id);
                records.push(RouteRecord {
                    record_type: record_type.to_owned(),
                    name: fqdn.clone(),
                    value: request.target_host.clone(),
                    priority: None,
                    port: None,
                    ttl: Some(self.ttl()),
                });

                fqdn.clone()
            }
            Err(_) => request.target_host.clone(),
        };

        let name = format!("_{service}._{protocol}.{fqdn}");
        let srv = self
            .post_record(
                &zone,
                &SrvRecordPayload {
                    record_type: "SRV",
                    name: &name,
                    data: SrvData {
                        priority: SRV_PRIORITY,
                        weight: SRV_WEIGHT,
                        port: request.target_port,
                        target: &srv_target,
                    },
                    ttl: self.ttl(),
                    comment: &request.label,
                },
            )
            .await;

        match srv {
            Ok(id) => {
                external_ids.push(id);
                records.push(RouteRecord {
                    record_type: "SRV".to_owned(),
                    name,
                    value: srv_target,
                    priority: Some(SRV_PRIORITY),
                    port: Some(request.target_port),
                    ttl: Some(self.ttl()),
                });
            }
            Err(err) => {
                if let Err(cleanup) = self.delete(&zone, &external_ids).await {
                    error!("Unable to roll back the Cloudflare records: {cleanup:?}");
                }
                return Err(err);
            }
        }

        Ok(ProvisionedRoute {
            external_ids,
            records,
        })
    }

    pub async fn delete(&self, zone: &str, external_ids: &[String]) -> Result<(), RouteError> {
        let base = self.records_url(zone)?;

        for id in external_ids {
            let response = self
                .client
                .delete(format!("{base}/{id}"))
                .bearer_auth(&self.config.api_token)
                .send()
                .await
                .map_err(|err| {
                    error!("Failed to reach Cloudflare: {err:?}");
                    RouteError::Unavailable
                })?;

            if !response.status().is_success()
                && response.status() != reqwest::StatusCode::NOT_FOUND
            {
                error!(
                    "Cloudflare rejected the record deletion with status {}",
                    response.status()
                );
                return Err(RouteError::Rejected);
            }
        }

        Ok(())
    }
}
