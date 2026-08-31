use crate::Backend;
use crate::db::route::RouteStatus;
use crate::db::server::ServerId;
use crate::integrity::{Check, CheckError};
use daemon_common::integrity::{IntegrityCategory, IntegrityFinding};
use sqlx::query;
use zelus::async_trait;

pub(crate) struct Routes;

#[async_trait]
impl Check for Routes {
    fn id(&self) -> &'static str {
        "routes"
    }

    fn title(&self) -> &'static str {
        "Routes point at their own server's port and reached their backend"
    }

    fn description(&self) -> &'static str {
        "A route publishes one port of one server under a domain. It must reference a port that \
         belongs to that same server, its domain must carry the link the route kind needs, and \
         the route must have been applied at its backend rather than being stuck pending or \
         failed."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Configuration
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let rows = query!(
            r#"SELECT
                   routes.id,
                   routes.server AS "server: ServerId",
                   routes.subdomain,
                   routes.kind::text AS "kind!",
                   routes.https,
                   routes.status AS "status: RouteStatus",
                   route_domains.domain,
                   route_domains.https AS domain_https,
                   route_domains.pangolin_domain_id,
                   route_domains.cloudflare_zone_id,
                   server_ports.server AS "port_server: ServerId",
                   servers.name AS server_name
               FROM routes
               JOIN route_domains ON route_domains.id = routes.domain
               JOIN server_ports ON server_ports.id = routes.port
               JOIN servers ON servers.id = routes.server
               ORDER BY routes.id"#
        )
        .fetch_all(&*backend.database)
        .await?;

        if rows.is_empty() {
            return Err(CheckError::Skipped(
                "No route is configured on this instance".to_owned(),
            ));
        }

        let mut findings = Vec::new();

        for row in rows {
            let subject = format!("{}.{}", row.subdomain, row.domain);
            let detail_server = format!("{} ({})", row.server_name, row.server);

            if row.port_server != row.server {
                findings.push(
                    IntegrityFinding::error(
                        "The route publishes a port that belongs to a different server",
                    )
                    .with_subject(subject.clone())
                    .with_detail("server", detail_server.clone())
                    .with_detail("port_owner", row.port_server.to_string()),
                );
            }

            match row.status {
                RouteStatus::Active => {}
                RouteStatus::Pending => findings.push(
                    IntegrityFinding::warning(
                        "The route was never applied at its backend and is still pending",
                    )
                    .with_subject(subject.clone())
                    .with_detail("server", detail_server.clone()),
                ),
                RouteStatus::Failed => findings.push(
                    IntegrityFinding::error(
                        "The route failed to apply at its backend and does not resolve",
                    )
                    .with_subject(subject.clone())
                    .with_detail("server", detail_server.clone()),
                ),
            }

            if row.https && !row.domain_https {
                findings.push(
                    IntegrityFinding::error(
                        "The route asks for https, but its domain is not served over https",
                    )
                    .with_subject(subject.clone())
                    .with_detail("server", detail_server.clone()),
                );
            }

            let missing_link = match row.kind.as_str() {
                "http" => row.pangolin_domain_id.is_none(),
                _ => row.cloudflare_zone_id.is_none(),
            };
            if missing_link {
                findings.push(
                    IntegrityFinding::error(format!(
                        "The domain of this {} route is not linked to the backend that has to \
                         publish it",
                        row.kind
                    ))
                    .with_subject(subject)
                    .with_detail("server", detail_server)
                    .with_detail("kind", row.kind),
                );
            }
        }

        Ok(findings)
    }
}
