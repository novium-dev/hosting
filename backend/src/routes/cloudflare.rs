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
struct TxtRecordPayload<'a> {
    #[serde(rename = "type")]
    record_type: &'a str,
    name: &'a str,
    content: &'a str,
    ttl: u32,
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

pub fn planned_records(request: &RouteRequest, ttl: u32) -> Vec<RouteRecord> {
    let fqdn = request.fqdn();
    let service = request
        .service
        .clone()
        .unwrap_or_else(|| service_name(&request.label));
    let protocol = request.kind.srv_protocol();

    let mut records = Vec::with_capacity(2);

    let address = request.target_host.parse::<IpAddr>().ok();
    let srv_target = if address.is_some() {
        fqdn.clone()
    } else {
        request.target_host.clone()
    };

    if let Some(address) = address {
        records.push(RouteRecord {
            record_type: if address.is_ipv4() { "A" } else { "AAAA" }.to_owned(),
            name: fqdn.clone(),
            value: request.target_host.clone(),
            priority: None,
            port: None,
            ttl: Some(ttl),
        });
    }

    records.push(RouteRecord {
        record_type: "SRV".to_owned(),
        name: format!("_{service}._{protocol}.{fqdn}"),
        value: srv_target,
        priority: Some(SRV_PRIORITY),
        port: Some(request.target_port),
        ttl: Some(ttl),
    });

    records
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

    pub async fn zone_of(&self, name: &str) -> Result<String, RouteError> {
        let mut candidate = name;
        loop {
            match self.zone(candidate).await {
                Err(RouteError::ZoneNotFound) => {}
                result => return result,
            }

            match candidate.split_once('.') {
                Some((_, parent)) if parent.contains('.') => candidate = parent,
                _ => return Err(RouteError::ZoneNotFound),
            }
        }
    }

    pub async fn create_txt(
        &self,
        zone: &str,
        name: &str,
        content: &str,
        comment: &str,
    ) -> Result<String, RouteError> {
        self.post_record(
            zone,
            &TxtRecordPayload {
                record_type: "TXT",
                name,
                content,
                ttl: DEFAULT_TTL,
                comment,
            },
        )
        .await
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
        let text = response.text().await.map_err(|err| {
            error!("Failed to read the Cloudflare response: {err:?}");
            RouteError::Rejected
        })?;

        let Ok(body) = serde_json::from_str::<CloudflareResponse>(&text) else {
            error!("Failed to decode the Cloudflare response with status {status}: {text}");
            return Err(RouteError::Rejected);
        };

        match body.result {
            Some(result) if body.success => Ok(result.id),
            _ => {
                error!("Cloudflare rejected the record creation with status {status}: {text}");
                Err(RouteError::Rejected)
            }
        }
    }

    async fn post_planned(
        &self,
        zone: &str,
        record: &RouteRecord,
        comment: &str,
    ) -> Result<String, RouteError> {
        match record.port {
            Some(port) => {
                self.post_record(
                    zone,
                    &SrvRecordPayload {
                        record_type: &record.record_type,
                        name: &record.name,
                        data: SrvData {
                            priority: record.priority.unwrap_or(SRV_PRIORITY),
                            weight: SRV_WEIGHT,
                            port,
                            target: &record.value,
                        },
                        ttl: self.ttl(),
                        comment,
                    },
                )
                .await
            }
            None => {
                self.post_record(
                    zone,
                    &AddressRecordPayload {
                        record_type: &record.record_type,
                        name: &record.name,
                        content: &record.value,
                        ttl: self.ttl(),
                        proxied: false,
                        comment,
                    },
                )
                .await
            }
        }
    }

    pub async fn create(&self, request: &RouteRequest) -> Result<ProvisionedRoute, RouteError> {
        let zone = match request.zone_id {
            Some(ref zone) => zone.clone(),
            None => self.zone(&request.domain).await?,
        };

        let records = planned_records(request, self.ttl());
        let mut external_ids = Vec::with_capacity(records.len());

        for record in &records {
            match self.post_planned(&zone, record, &request.label).await {
                Ok(id) => external_ids.push(id),
                Err(err) => {
                    if let Err(cleanup) = self.delete(&zone, &external_ids).await {
                        error!("Unable to roll back the Cloudflare records: {cleanup:?}");
                    }
                    return Err(err);
                }
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
