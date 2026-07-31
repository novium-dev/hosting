use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::routes::{RouteProvider, RouteProviderError, RouteRecord};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Executor, Postgres, query, query_as};
use std::sync::Arc;
use tracing::{error, warn};

#[derive(
    Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "route_status", rename_all = "lowercase")]
pub enum RouteStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "failed")]
    Failed,
}

#[derive(Debug, Clone)]
pub struct RouteDomain {
    pub id: i32,
    pub domain: String,
    pub provider: String,
    pub provider_domain_id: Option<String>,
    pub srv_service: Option<String>,
    pub https: bool,
    pub private: bool,
}

#[derive(Debug, Clone)]
pub struct StoredRoute {
    pub id: i32,
    pub server: ServerId,
    pub domain: i32,
    pub subdomain: String,
    pub port: i32,
    pub https: bool,
    pub status: RouteStatus,
    pub external_ids: Vec<String>,
    pub records: Value,
}

pub fn decode_records(records: &Value) -> Vec<RouteRecord> {
    serde_json::from_value(records.clone()).unwrap_or_else(|err| {
        warn!("Unable to decode the stored route records: {err:?}");
        Vec::new()
    })
}

impl Backend {
    pub(crate) fn route_provider(
        &self,
        provider: &str,
    ) -> Option<Arc<dyn RouteProvider + Send + Sync>> {
        self.route_providers.get(provider).map(Arc::clone)
    }

    pub(crate) async fn route_domains<'e, E: Executor<'e, Database = Postgres>>(
        &self,
        executor: E,
    ) -> Result<Vec<RouteDomain>, sqlx::Error> {
        query_as!(
            RouteDomain,
            r#"SELECT id, domain, provider, provider_domain_id, srv_service, https, private
               FROM route_domains
               ORDER BY domain"#
        )
        .fetch_all(executor)
        .await
    }

    pub(crate) async fn route_domain<'e, E: Executor<'e, Database = Postgres>>(
        &self,
        executor: E,
        domain_id: i32,
    ) -> Result<Option<RouteDomain>, sqlx::Error> {
        query_as!(
            RouteDomain,
            r#"SELECT id, domain, provider, provider_domain_id, srv_service, https, private
               FROM route_domains
               WHERE id = $1"#,
            domain_id
        )
        .fetch_optional(executor)
        .await
    }

    pub(crate) async fn route_domain_projects<'e, E: Executor<'e, Database = Postgres>>(
        &self,
        executor: E,
        domain_id: i32,
    ) -> Result<Vec<ProjectId>, sqlx::Error> {
        query!(
            r#"SELECT project AS "project: ProjectId" FROM route_domain_projects WHERE domain = $1"#,
            domain_id
        )
        .fetch_all(executor)
        .await
        .map(|rows| rows.into_iter().map(|row| row.project).collect())
    }

    pub(crate) async fn routes_of_server<'e, E: Executor<'e, Database = Postgres>>(
        &self,
        executor: E,
        server: ServerId,
    ) -> Result<Vec<StoredRoute>, sqlx::Error> {
        query_as!(
            StoredRoute,
            r#"SELECT
                id,
                server AS "server: ServerId",
                domain,
                subdomain,
                port,
                https,
                status AS "status: RouteStatus",
                external_ids,
                records
               FROM routes
               WHERE server = $1
               ORDER BY id"#,
            &server
        )
        .fetch_all(executor)
        .await
    }

    pub(crate) async fn deprovision_routes(&self, routes: &[(StoredRoute, String)]) {
        for (route, provider) in routes {
            let Some(provider) = self.route_provider(provider) else {
                warn!(
                    "Route {} references the unknown provider {provider}; skipping the cleanup",
                    route.id
                );
                continue;
            };

            if let Err(err) = provider.delete_route(&route.external_ids).await {
                error!(
                    "Unable to remove route {} at its provider: {err:?}",
                    route.id
                );
            }
        }
    }

    pub(crate) async fn server_routes_with_provider(
        &self,
        server: ServerId,
    ) -> Result<Vec<(StoredRoute, String)>, sqlx::Error> {
        Ok(query!(
            r#"SELECT
                routes.id,
                routes.server AS "server: ServerId",
                routes.domain,
                routes.subdomain,
                routes.port,
                routes.https,
                routes.status AS "status: RouteStatus",
                routes.external_ids,
                routes.records,
                route_domains.provider
               FROM routes
               JOIN route_domains ON route_domains.id = routes.domain
               WHERE routes.server = $1"#,
            &server
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| {
            (
                StoredRoute {
                    id: row.id,
                    server: row.server,
                    domain: row.domain,
                    subdomain: row.subdomain,
                    port: row.port,
                    https: row.https,
                    status: row.status,
                    external_ids: row.external_ids,
                    records: row.records,
                },
                row.provider,
            )
        })
        .collect())
    }

    pub(crate) async fn port_routes_with_provider(
        &self,
        port_id: i32,
    ) -> Result<Vec<(StoredRoute, String)>, sqlx::Error> {
        Ok(query!(
            r#"SELECT
                routes.id,
                routes.server AS "server: ServerId",
                routes.domain,
                routes.subdomain,
                routes.port,
                routes.https,
                routes.status AS "status: RouteStatus",
                routes.external_ids,
                routes.records,
                route_domains.provider
               FROM routes
               JOIN route_domains ON route_domains.id = routes.domain
               WHERE routes.port = $1"#,
            port_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| {
            (
                StoredRoute {
                    id: row.id,
                    server: row.server,
                    domain: row.domain,
                    subdomain: row.subdomain,
                    port: row.port,
                    https: row.https,
                    status: row.status,
                    external_ids: row.external_ids,
                    records: row.records,
                },
                row.provider,
            )
        })
        .collect())
    }
}

impl core::fmt::Display for RouteProviderError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(match *self {
            Self::Unavailable => "provider unavailable",
            Self::Rejected => "provider rejected the request",
        })
    }
}
