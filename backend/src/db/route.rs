use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::routes::{RouteHandle, RouteKind, RouteRecord};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Executor, Postgres, query, query_as};
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
    pub pangolin_domain_id: Option<String>,
    pub cloudflare_zone_id: Option<String>,
    pub https: bool,
    pub private: bool,
    pub project: Option<ProjectId>,
    pub verified: bool,
}

impl RouteDomain {
    pub const fn is_platform(&self) -> bool {
        self.project.is_none()
    }
}

#[derive(Debug, Clone)]
pub struct ProjectRouteDomain {
    pub id: i32,
    pub domain: String,
    pub verification_token: String,
    pub verified_at: Option<DateTime<Utc>>,
    pub verify_checked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub certificate_issued_at: Option<DateTime<Utc>>,
    pub certificate_expires_at: Option<DateTime<Utc>>,
    pub certificate_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredRoute {
    pub id: i32,
    pub server: ServerId,
    pub domain: i32,
    pub domain_name: String,
    pub zone_id: Option<String>,
    pub subdomain: String,
    pub port: i32,
    pub kind: RouteKind,
    pub service: Option<String>,
    pub https: bool,
    pub status: RouteStatus,
    pub external_ids: Vec<String>,
    pub records: Value,
    pub custom: bool,
}

impl StoredRoute {
    pub fn handle(&self) -> RouteHandle<'_> {
        RouteHandle {
            kind: self.kind,
            domain: &self.domain_name,
            zone_id: self.zone_id.as_deref(),
            external_ids: &self.external_ids,
            custom: self.custom,
        }
    }
}

pub fn decode_records(records: &Value) -> Vec<RouteRecord> {
    serde_json::from_value(records.clone()).unwrap_or_else(|err| {
        warn!("Unable to decode the stored route records: {err:?}");
        Vec::new()
    })
}

impl Backend {
    pub(crate) async fn route_domains<'e, E: Executor<'e, Database = Postgres>>(
        &self,
        executor: E,
    ) -> Result<Vec<RouteDomain>, sqlx::Error> {
        query_as!(
            RouteDomain,
            r#"SELECT id, domain, pangolin_domain_id, cloudflare_zone_id, https, private,
                      project AS "project: ProjectId",
                      (verified_at IS NOT NULL) AS "verified!"
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
            r#"SELECT id, domain, pangolin_domain_id, cloudflare_zone_id, https, private,
                      project AS "project: ProjectId",
                      (verified_at IS NOT NULL) AS "verified!"
               FROM route_domains
               WHERE id = $1"#,
            domain_id
        )
        .fetch_optional(executor)
        .await
    }

    pub(crate) async fn project_route_domains<'e, E: Executor<'e, Database = Postgres>>(
        &self,
        executor: E,
        project: ProjectId,
    ) -> Result<Vec<ProjectRouteDomain>, sqlx::Error> {
        query_as!(
            ProjectRouteDomain,
            r#"SELECT route_domains.id, route_domains.domain,
                      route_domains.verification_token AS "verification_token!",
                      route_domains.verified_at, route_domains.verify_checked_at,
                      route_domains.created_at,
                      certificates.issued_at AS "certificate_issued_at?",
                      certificates.expires_at AS "certificate_expires_at?",
                      certificates.last_error AS "certificate_error?"
               FROM route_domains
               LEFT JOIN route_domain_certificates certificates
                   ON certificates.domain = route_domains.id
               WHERE route_domains.project = $1
               ORDER BY route_domains.domain"#,
            &project
        )
        .fetch_all(executor)
        .await
    }

    pub(crate) async fn project_route_domain<'e, E: Executor<'e, Database = Postgres>>(
        &self,
        executor: E,
        project: ProjectId,
        domain_id: i32,
    ) -> Result<Option<ProjectRouteDomain>, sqlx::Error> {
        query_as!(
            ProjectRouteDomain,
            r#"SELECT route_domains.id, route_domains.domain,
                      route_domains.verification_token AS "verification_token!",
                      route_domains.verified_at, route_domains.verify_checked_at,
                      route_domains.created_at,
                      certificates.issued_at AS "certificate_issued_at?",
                      certificates.expires_at AS "certificate_expires_at?",
                      certificates.last_error AS "certificate_error?"
               FROM route_domains
               LEFT JOIN route_domain_certificates certificates
                   ON certificates.domain = route_domains.id
               WHERE route_domains.project = $1 AND route_domains.id = $2"#,
            &project,
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
                routes.id,
                routes.server AS "server: ServerId",
                routes.domain,
                route_domains.domain AS domain_name,
                route_domains.cloudflare_zone_id AS zone_id,
                (route_domains.project IS NOT NULL) AS "custom!",
                routes.subdomain,
                routes.port,
                routes.kind AS "kind: RouteKind",
                routes.service,
                routes.https,
                routes.status AS "status: RouteStatus",
                routes.external_ids,
                routes.records
               FROM routes
               JOIN route_domains ON route_domains.id = routes.domain
               WHERE routes.server = $1
               ORDER BY routes.id"#,
            &server
        )
        .fetch_all(executor)
        .await
    }

    pub(crate) async fn deprovision_routes(&self, routes: &[StoredRoute]) {
        for route in routes {
            if let Err(err) = self.route_backends.delete(route.handle()).await {
                error!(
                    "Unable to remove route {} at its backend: {err:?}",
                    route.id
                );
            }
        }
    }

    pub(crate) async fn server_routes(
        &self,
        server: ServerId,
    ) -> Result<Vec<StoredRoute>, sqlx::Error> {
        self.routes_of_server(&*self.database, server).await
    }

    pub(crate) async fn port_routes(&self, port_id: i32) -> Result<Vec<StoredRoute>, sqlx::Error> {
        query_as!(
            StoredRoute,
            r#"SELECT
                routes.id,
                routes.server AS "server: ServerId",
                routes.domain,
                route_domains.domain AS domain_name,
                route_domains.cloudflare_zone_id AS zone_id,
                (route_domains.project IS NOT NULL) AS "custom!",
                routes.subdomain,
                routes.port,
                routes.kind AS "kind: RouteKind",
                routes.service,
                routes.https,
                routes.status AS "status: RouteStatus",
                routes.external_ids,
                routes.records
               FROM routes
               JOIN route_domains ON route_domains.id = routes.domain
               WHERE routes.port = $1"#,
            port_id
        )
        .fetch_all(&*self.database)
        .await
    }
}

impl core::fmt::Display for crate::routes::RouteError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(match *self {
            Self::Unavailable => "backend unavailable",
            Self::Rejected => "backend rejected the request",
            Self::DomainNotLinked => "domain is not linked at the backend",
            Self::ZoneNotFound => "no cloudflare zone carries this domain",
        })
    }
}
