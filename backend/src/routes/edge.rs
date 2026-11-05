use crate::Backend;
use crate::config::EdgeConfig;
use crate::routes::RouteRecord;
use futures::StreamExt as _;
use redis::{AsyncCommands as _, AsyncIter, RedisError};
use serde::Serialize;
use sqlx::query;
use std::collections::{BTreeMap, HashMap};
use tracing::{debug, error};

const HTTPS_ENTRY_POINT: &str = "websecure";

const HTTP_ENTRY_POINT: &str = "web";

const REDIRECT_MIDDLEWARE: &str = "novium-https-redirect";

const HTTPS_SERVICE: &str = "novium-edge-https";

const HTTP_SERVICE: &str = "novium-edge-http";

const SERVERS_TRANSPORT: &str = "novium-edge";

const EDGE_RECORD_TTL: u32 = 300;

#[derive(Debug, Default, Serialize, utoipa::ToSchema)]
pub(crate) struct TraefikConfig {
    pub(crate) http: TraefikHttp,
    pub(crate) tls: TraefikTls,
}

#[derive(Debug, Default, Serialize, utoipa::ToSchema)]
pub(crate) struct TraefikHttp {
    pub(crate) routers: BTreeMap<String, TraefikRouter>,
    pub(crate) services: BTreeMap<String, TraefikService>,
    pub(crate) middlewares: BTreeMap<String, TraefikMiddleware>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TraefikRouter {
    pub(crate) rule: String,
    pub(crate) service: String,
    pub(crate) entry_points: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) middlewares: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) tls: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TraefikService {
    pub(crate) load_balancer: TraefikLoadBalancer,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct TraefikLoadBalancer {
    pub(crate) servers: Vec<TraefikServer>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct TraefikServer {
    pub(crate) url: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TraefikMiddleware {
    pub(crate) redirect_scheme: TraefikRedirectScheme,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct TraefikRedirectScheme {
    pub(crate) scheme: String,
    pub(crate) permanent: bool,
}

#[derive(Debug, Default, Serialize, utoipa::ToSchema)]
pub(crate) struct TraefikTls {
    pub(crate) certificates: Vec<TraefikCertificate>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TraefikCertificate {
    pub(crate) cert_file: String,
    pub(crate) key_file: String,
}

pub fn edge_record(domain: &str, public_host: &str) -> RouteRecord {
    RouteRecord {
        record_type: "CNAME".to_owned(),
        name: format!("*.{domain}"),
        value: public_host.to_owned(),
        priority: None,
        port: None,
        ttl: Some(EDGE_RECORD_TTL),
    }
}

fn subdomain_pattern(domain: &str) -> String {
    format!("^[a-z0-9-]+\\.{}$", domain.replace('.', "\\."))
}

fn target_url(host: &str, port: i32) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

fn passthrough_keys(config: &EdgeConfig, domains: &[(i32, String)]) -> HashMap<String, String> {
    if domains.is_empty() {
        return HashMap::new();
    }

    let root = config.root_key.trim_end_matches('/');
    let mut keys = HashMap::new();
    let mut set = |key: String, value: String| {
        keys.insert(format!("{root}/{key}"), value);
    };

    set(
        format!("tcp/services/{HTTPS_SERVICE}/loadbalancer/servers/0/address"),
        config.https_address.clone(),
    );
    set(
        format!("http/services/{HTTP_SERVICE}/loadbalancer/servers/0/url"),
        config.http_url.to_string(),
    );

    if config.proxy_protocol {
        set(
            format!("tcp/serversTransports/{SERVERS_TRANSPORT}/proxyProtocol/version"),
            "2".to_owned(),
        );
        set(
            format!("tcp/services/{HTTPS_SERVICE}/loadbalancer/serverstransport"),
            format!("{SERVERS_TRANSPORT}@redis"),
        );
    }

    for &(id, ref domain) in domains {
        let router = format!("novium-domain-{id}");
        let pattern = subdomain_pattern(domain);

        set(
            format!("tcp/routers/{router}/rule"),
            format!("HostSNI(`{domain}`) || HostSNIRegexp(`{pattern}`)"),
        );
        set(
            format!("tcp/routers/{router}/entrypoints/0"),
            HTTPS_ENTRY_POINT.to_owned(),
        );
        set(
            format!("tcp/routers/{router}/service"),
            HTTPS_SERVICE.to_owned(),
        );
        set(
            format!("tcp/routers/{router}/tls/passthrough"),
            "true".to_owned(),
        );

        set(
            format!("http/routers/{router}/rule"),
            format!("Host(`{domain}`) || HostRegexp(`{pattern}`)"),
        );
        set(
            format!("http/routers/{router}/entrypoints/0"),
            HTTP_ENTRY_POINT.to_owned(),
        );
        set(
            format!("http/routers/{router}/service"),
            HTTP_SERVICE.to_owned(),
        );
    }

    keys
}

impl Backend {
    pub(crate) async fn edge_traefik_config(&self) -> Result<TraefikConfig, sqlx::Error> {
        let routes = query!(
            r#"SELECT
                routes.id,
                routes.subdomain,
                routes.https,
                route_domains.domain,
                server_ports.host,
                lower(server_ports.external_port) AS "external_port!"
               FROM routes
               JOIN route_domains ON route_domains.id = routes.domain
               JOIN server_ports ON server_ports.id = routes.port
               WHERE route_domains.project IS NOT NULL
                 AND route_domains.verified_at IS NOT NULL
                 AND routes.kind = 'http'
               ORDER BY routes.id"#
        )
        .fetch_all(&*self.database)
        .await?;

        let certificates = query!(
            r#"SELECT
                certificates.certificate_pem AS "certificate_pem!",
                certificates.private_key_pem AS "private_key_pem!"
               FROM route_domain_certificates certificates
               JOIN route_domains ON route_domains.id = certificates.domain
               WHERE route_domains.verified_at IS NOT NULL
                 AND certificates.certificate_pem IS NOT NULL
                 AND certificates.expires_at > now()"#
        )
        .fetch_all(&*self.database)
        .await?;

        let mut config = TraefikConfig::default();

        if routes.iter().any(|route| route.https) {
            config.http.middlewares.insert(
                REDIRECT_MIDDLEWARE.to_owned(),
                TraefikMiddleware {
                    redirect_scheme: TraefikRedirectScheme {
                        scheme: "https".to_owned(),
                        permanent: true,
                    },
                },
            );
        }

        for route in routes {
            let name = format!("novium-route-{}", route.id);
            let rule = format!("Host(`{}.{}`)", route.subdomain, route.domain);

            config.http.services.insert(
                name.clone(),
                TraefikService {
                    load_balancer: TraefikLoadBalancer {
                        servers: vec![TraefikServer {
                            url: target_url(&route.host, route.external_port),
                        }],
                    },
                },
            );

            if route.https {
                config.http.routers.insert(
                    name.clone(),
                    TraefikRouter {
                        rule: rule.clone(),
                        service: name.clone(),
                        entry_points: vec![HTTPS_ENTRY_POINT.to_owned()],
                        middlewares: Vec::new(),
                        tls: Some(BTreeMap::new()),
                    },
                );
                config.http.routers.insert(
                    format!("{name}-redirect"),
                    TraefikRouter {
                        rule,
                        service: name,
                        entry_points: vec![HTTP_ENTRY_POINT.to_owned()],
                        middlewares: vec![REDIRECT_MIDDLEWARE.to_owned()],
                        tls: None,
                    },
                );
            } else {
                config.http.routers.insert(
                    name.clone(),
                    TraefikRouter {
                        rule,
                        service: name,
                        entry_points: vec![HTTP_ENTRY_POINT.to_owned()],
                        middlewares: Vec::new(),
                        tls: None,
                    },
                );
            }
        }

        config.tls.certificates = certificates
            .into_iter()
            .map(|certificate| TraefikCertificate {
                cert_file: certificate.certificate_pem,
                key_file: certificate.private_key_pem,
            })
            .collect();

        Ok(config)
    }

    async fn write_edge_passthrough(
        &self,
        config: &EdgeConfig,
        desired: HashMap<String, String>,
    ) -> Result<(), RedisError> {
        let mut cache = self.cache.clone();
        let pattern = format!("{}/*", config.root_key.trim_end_matches('/'));

        let existing = {
            let iter: AsyncIter<'_, String> = cache.scan_match(&pattern).await?;
            iter.collect::<Vec<Result<String, RedisError>>>()
                .await
                .into_iter()
                .collect::<Result<Vec<_>, _>>()?
        };

        let stale = existing
            .iter()
            .filter(|key| !desired.contains_key(*key))
            .cloned()
            .collect::<Vec<_>>();

        let mut keys = desired.keys().cloned().collect::<Vec<_>>();
        keys.sort();

        let current: Vec<Option<String>> = if keys.is_empty() {
            Vec::new()
        } else {
            cache.mget(&keys).await?
        };

        let changed = keys
            .into_iter()
            .zip(current)
            .filter_map(|(key, value)| {
                let wanted = desired.get(&key)?;
                (value.as_ref() != Some(wanted)).then(|| (key, wanted.clone()))
            })
            .collect::<Vec<_>>();

        if !changed.is_empty() {
            cache.mset::<_, _, ()>(&changed).await?;
        }

        if !stale.is_empty() {
            cache.del::<_, ()>(&stale).await?;
        }

        if !changed.is_empty() || !stale.is_empty() {
            debug!(
                "Updated the edge passthrough: {} keys written, {} removed",
                changed.len(),
                stale.len()
            );
        }

        Ok(())
    }

    pub(crate) async fn sync_edge(&self) {
        let Some(config) = self.config.routes.edge.as_ref() else {
            return;
        };

        let domains = match query!(
            r#"SELECT id, domain FROM route_domains
               WHERE project IS NOT NULL AND verified_at IS NOT NULL
               ORDER BY id"#
        )
        .fetch_all(&*self.database)
        .await
        {
            Ok(rows) => rows
                .into_iter()
                .map(|row| (row.id, row.domain))
                .collect::<Vec<_>>(),
            Err(err) => {
                error!("Unable to load the domains for the edge passthrough: {err:?}");
                return;
            }
        };

        if let Err(err) = self
            .write_edge_passthrough(config, passthrough_keys(config, &domains))
            .await
        {
            error!("Unable to write the edge passthrough: {err:?}");
        }
    }
}
