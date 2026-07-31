use crate::config::LocalConfig;
use crate::routes::{
    ProvisionedRoute, RouteProvider, RouteProviderError, RouteRecord, RouteRequest,
};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Mutex;
use tracing::info;

const DEFAULT_TTL: u32 = 60;

pub struct LocalProvider {
    config: LocalConfig,
    routes: Mutex<HashMap<String, String>>,
}

impl LocalProvider {
    pub fn new(config: LocalConfig) -> Self {
        Self {
            config,
            routes: Mutex::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl RouteProvider for LocalProvider {
    fn kind(&self) -> &'static str {
        "local"
    }

    fn requires_provider_domain_id(&self) -> bool {
        false
    }

    async fn create_route(
        &self,
        request: &RouteRequest,
    ) -> Result<ProvisionedRoute, RouteProviderError> {
        if self.config.fail {
            return Err(RouteProviderError::Rejected);
        }

        let fqdn = request.fqdn();
        let target = format!("{}:{}", request.target_host, request.target_port);

        let mut records = vec![RouteRecord {
            record_type: "CNAME".to_owned(),
            name: fqdn.clone(),
            value: request.target_host.clone(),
            priority: None,
            port: None,
            ttl: Some(DEFAULT_TTL),
            proxied: false,
        }];

        if let Some(ref service) = request.srv_service {
            records.push(RouteRecord {
                record_type: "SRV".to_owned(),
                name: format!("_{service}._tcp.{fqdn}"),
                value: fqdn.clone(),
                priority: Some(0),
                port: Some(request.target_port),
                ttl: Some(DEFAULT_TTL),
                proxied: false,
            });
        }

        let external_id = format!("local-{fqdn}");

        if let Ok(mut routes) = self.routes.lock() {
            routes.insert(external_id.clone(), target.clone());
        }

        info!("Local route provider created {} -> {target}", request.url());

        Ok(ProvisionedRoute {
            external_ids: vec![external_id],
            records,
        })
    }

    async fn delete_route(&self, external_ids: &[String]) -> Result<(), RouteProviderError> {
        if self.config.fail {
            return Err(RouteProviderError::Rejected);
        }

        for id in external_ids {
            if let Ok(mut routes) = self.routes.lock() {
                routes.remove(id);
            }
            info!("Local route provider removed {id}");
        }

        Ok(())
    }
}
