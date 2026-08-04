use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};
use crate::db::project::ProjectId;
use crate::db::route::{RouteStatus, decode_records};
use crate::db::server::ServerId;
use crate::db::server::ports::NetworkProtocol;
use crate::routes::{
    RouteError, RouteKind, RouteRecord, RouteRequest, is_valid_label, service_name,
};
use crate::service::route::route_service_error::{
    CreateRouteError, DeleteRouteError, ListRouteDomainsError, ListRoutesError,
};
use crate::service::*;
use serde::{Deserialize, Serialize};
use sqlx::query;
use tracing::error;
use zelus::{define_query_variable, service};

define_query_variable!(project "The project the domains are listed for");

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the domain's flags in the api response"
)]
pub(crate) struct RouteDomainInfo {
    pub(crate) id: i32,
    pub(crate) domain: String,
    pub(crate) https: bool,
    pub(crate) private: bool,
    pub(crate) http_available: bool,
    pub(crate) tcp_available: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteInfo {
    pub(crate) id: i32,
    pub(crate) server: ServerId,
    pub(crate) domain: i32,
    pub(crate) subdomain: String,
    pub(crate) fqdn: String,
    pub(crate) address: String,
    pub(crate) kind: RouteKind,
    pub(crate) service: Option<String>,
    pub(crate) https: bool,
    pub(crate) port: i32,
    pub(crate) external_port: u16,
    pub(crate) status: RouteStatus,
    pub(crate) records: Vec<RouteRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct RoutePayload {
    pub(crate) domain: i32,
    pub(crate) subdomain: String,
    pub(crate) port: i32,
    pub(crate) service: Option<String>,
    pub(crate) https: Option<bool>,
}

#[service(path = "/route", tag = "route", no_sdk)]
pub(crate) impl RouteService for Backend {
    /// Lists the route domains that can be used for new routes.
    ///
    /// `http_available` and `tcp_available` tell which kinds of routes the domain can carry:
    /// HTTP routes need Pangolin and a linked Pangolin domain, TCP routes need Cloudflare and a
    /// resolved zone for the domain.
    ///
    /// Private domains are only listed when the given project has been granted access to them,
    /// or when the caller holds [`ManagementPermissions::DOMAINS_VIEW`].
    #[route("/domains", method = GET, query = [project])]
    #[error(auth::{permission_denied, unreachable}, project::not_found, db::failure <- [sql:*])]
    async fn list_route_domains(
        &self,
        #[special] auth: Authentication,
        project: Option<ProjectId>,
    ) -> Result<Vec<RouteDomainInfo>, _> {
        if auth.user_id().is_none() {
            return Err(ListRouteDomainsError::AuthInvalid);
        }

        if let Some(project) = project {
            auth.require::<_, _, ListRouteDomainsError>(project, ProjectPermissions::VIEW)?;
        }

        let all = auth.has((), ManagementPermissions::DOMAINS_VIEW);

        let granted: Vec<i32> = match project {
            Some(project) => query!(
                "SELECT domain FROM route_domain_projects WHERE project = $1",
                &project
            )
            .fetch_all(&*self.database)
            .await?
            .into_iter()
            .map(|row| row.domain)
            .collect(),
            None => Vec::new(),
        };

        Ok(self
            .route_domains(&*self.database)
            .await?
            .into_iter()
            .filter(|domain| all || !domain.private || granted.contains(&domain.id))
            .map(|domain| RouteDomainInfo {
                id: domain.id,
                domain: domain.domain,
                https: domain.https,
                private: domain.private,
                http_available: self.route_backends.supports(RouteKind::Http)
                    && domain.pangolin_domain_id.is_some(),
                tcp_available: self.route_backends.supports(RouteKind::Tcp)
                    && domain.cloudflare_zone_id.is_some(),
            })
            .collect())
    }

    /// Lists all routes pointing at the server.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::ROUTES_VIEW`].
    #[route("/{server_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, server::not_found, db::failure <- [sql:*])]
    async fn list_routes(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Vec<RouteInfo>, _> {
        auth.require::<_, _, ListRoutesError>(server_id, ServerPermissions::ROUTES_VIEW)?;

        let domains = self.route_domains(&*self.database).await?;

        let mut routes = Vec::new();
        for route in self.routes_of_server(&*self.database, server_id).await? {
            let Some(domain) = domains.iter().find(|domain| domain.id == route.domain) else {
                continue;
            };

            let external_port = query!(
                r#"SELECT lower(external_port) AS "external_port!" FROM server_ports WHERE id = $1"#,
                route.port
            )
            .fetch_optional(&*self.database)
            .await?
            .and_then(|row| u16::try_from(row.external_port).ok())
            .unwrap_or_default();

            let fqdn = format!("{}.{}", route.subdomain, domain.domain);
            let address = match route.kind {
                RouteKind::Http => {
                    let scheme = if route.https { "https" } else { "http" };
                    format!("{scheme}://{fqdn}")
                }
                RouteKind::Tcp => fqdn.clone(),
            };

            routes.push(RouteInfo {
                id: route.id,
                server: route.server,
                domain: route.domain,
                subdomain: route.subdomain,
                address,
                fqdn,
                kind: route.kind,
                service: route.service,
                https: route.https,
                port: route.port,
                external_port,
                status: route.status,
                records: decode_records(&route.records),
            });
        }

        Ok(routes)
    }

    /// Creates a route for the server and provisions it.
    ///
    /// The kind of route follows the selected port: a port marked as an HTTP port becomes a
    /// Pangolin resource reachable at the subdomain, any other TCP port gets a Cloudflare SRV
    /// record so clients reach it without typing the port. UDP ports cannot be routed.
    ///
    /// `service` is the SRV service name for TCP routes (`minecraft` produces
    /// `_minecraft._tcp.<subdomain>.<domain>`) and defaults to the port's name.
    /// `https` only applies to HTTP routes.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::ROUTES_MANAGE`].
    #[route("/{server_id}", method = PUT)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        route::{domain_not_found, subdomain_invalid, subdomain_taken, port_invalid, service_invalid,
            https_unavailable, kind_unavailable, domain_not_linked, zone_not_found,
            backend_unavailable, backend_error},
        db::failure <- [sql:*]
    )]
    async fn create_route(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        payload: RoutePayload,
    ) -> Result<RouteInfo, _> {
        auth.require::<_, _, CreateRouteError>(server_id, ServerPermissions::ROUTES_MANAGE)?;

        let subdomain = payload.subdomain.trim().to_lowercase();
        if !is_valid_label(&subdomain) {
            return Err(CreateRouteError::RouteSubdomainInvalid);
        }

        let server = query!(
            r#"SELECT name, project AS "project: ProjectId" FROM servers WHERE id = $1"#,
            &server_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(CreateRouteError::ServerNotFound)?;

        let domain = self
            .route_domain(&*self.database, payload.domain)
            .await?
            .ok_or(CreateRouteError::RouteDomainNotFound)?;

        if domain.private
            && !auth.has((), ManagementPermissions::DOMAINS_VIEW)
            && query!(
                "SELECT domain FROM route_domain_projects WHERE domain = $1 AND project = $2",
                domain.id,
                &server.project
            )
            .fetch_optional(&*self.database)
            .await?
            .is_none()
        {
            return Err(CreateRouteError::RouteDomainNotFound);
        }

        let port = query!(
            r#"SELECT
                name,
                host,
                http,
                protocol AS "protocol: NetworkProtocol",
                lower(external_port) AS "external_port!"
               FROM server_ports
               WHERE id = $1 AND server = $2"#,
            payload.port,
            &server_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(CreateRouteError::RoutePortInvalid)?;

        if port.protocol != NetworkProtocol::Tcp {
            return Err(CreateRouteError::RoutePortInvalid);
        }

        let kind = if port.http {
            RouteKind::Http
        } else {
            RouteKind::Tcp
        };

        if !self.route_backends.supports(kind) {
            return Err(CreateRouteError::RouteKindUnavailable);
        }

        if matches!(kind, RouteKind::Http) && domain.pangolin_domain_id.is_none() {
            return Err(CreateRouteError::RouteDomainNotLinked);
        }

        let zone_id = match kind {
            RouteKind::Http => None,
            RouteKind::Tcp => match domain.cloudflare_zone_id.clone() {
                Some(zone) => Some(zone),
                None => {
                    let zone = self
                        .route_backends
                        .zone(&domain.domain)
                        .await
                        .map_err(|err| match err {
                            RouteError::ZoneNotFound | RouteError::DomainNotLinked => {
                                CreateRouteError::RouteZoneNotFound
                            }
                            RouteError::Unavailable => CreateRouteError::RouteBackendUnavailable,
                            RouteError::Rejected => CreateRouteError::RouteBackendError,
                        })?;

                    query!(
                        "UPDATE route_domains SET cloudflare_zone_id = $1 WHERE id = $2",
                        zone,
                        domain.id,
                    )
                    .execute(&*self.database)
                    .await?;

                    Some(zone)
                }
            },
        };

        let https = matches!(kind, RouteKind::Http) && payload.https.unwrap_or(true);
        if https && !domain.https {
            return Err(CreateRouteError::RouteHttpsUnavailable);
        }

        let service = match kind {
            RouteKind::Http => None,
            RouteKind::Tcp => {
                let service = payload.service.map_or_else(
                    || service_name(&port.name),
                    |service| service.trim().to_lowercase(),
                );

                if !is_valid_label(&service) || service.len() > 32 {
                    return Err(CreateRouteError::RouteServiceInvalid);
                }

                Some(service)
            }
        };

        let external_port =
            u16::try_from(port.external_port).map_err(|_err| CreateRouteError::RoutePortInvalid)?;

        let Some(route_id) = query!(
            r#"INSERT INTO routes (server, domain, subdomain, port, kind, service, https)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (domain, subdomain) DO NOTHING
               RETURNING id"#,
            &server_id,
            domain.id,
            subdomain,
            payload.port,
            kind as RouteKind,
            service,
            https,
        )
        .fetch_optional(&*self.database)
        .await?
        .map(|row| row.id) else {
            return Err(CreateRouteError::RouteSubdomainTaken);
        };

        let request = RouteRequest {
            domain: domain.domain.clone(),
            subdomain: subdomain.clone(),
            kind,
            service: service.clone(),
            zone_id,
            pangolin_domain_id: domain.pangolin_domain_id.clone(),
            https,
            target_host: port.host,
            target_port: external_port,
            label: format!("{} ({server_id})", server.name),
        };

        let provisioned = match self.route_backends.create(&request).await {
            Ok(provisioned) => provisioned,
            Err(err) => {
                if let Err(cleanup) = query!("DELETE FROM routes WHERE id = $1", route_id)
                    .execute(&*self.database)
                    .await
                {
                    error!("Unable to remove the failed route: {cleanup:?}");
                }

                return Err(match err {
                    RouteError::Unavailable => CreateRouteError::RouteBackendUnavailable,
                    RouteError::Rejected => CreateRouteError::RouteBackendError,
                    RouteError::DomainNotLinked => CreateRouteError::RouteDomainNotLinked,
                    RouteError::ZoneNotFound => CreateRouteError::RouteZoneNotFound,
                });
            }
        };

        let records = serde_json::to_value(&provisioned.records).unwrap_or_default();

        query!(
            r#"UPDATE routes SET status = $1, external_ids = $2, records = $3 WHERE id = $4"#,
            RouteStatus::Active as RouteStatus,
            &provisioned.external_ids,
            records,
            route_id,
        )
        .execute(&*self.database)
        .await?;

        Ok(RouteInfo {
            id: route_id,
            server: server_id,
            domain: domain.id,
            subdomain,
            fqdn: request.fqdn(),
            address: request.address(),
            kind,
            service,
            https,
            port: payload.port,
            external_port,
            status: RouteStatus::Active,
            records: provisioned.records,
        })
    }

    /// Deletes a route and removes it from its backend.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::ROUTES_MANAGE`].
    #[route("/{server_id}/{route_id}", method = DELETE)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        route::{not_found, backend_unavailable, backend_error},
        db::failure <- [sql:*]
    )]
    async fn delete_route(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        route_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteRouteError>(server_id, ServerPermissions::ROUTES_MANAGE)?;

        let route = self
            .routes_of_server(&*self.database, server_id)
            .await?
            .into_iter()
            .find(|route| route.id == route_id)
            .ok_or(DeleteRouteError::RouteNotFound)?;

        self.route_backends
            .delete(route.handle())
            .await
            .map_err(|err| match err {
                RouteError::Unavailable
                | RouteError::DomainNotLinked
                | RouteError::ZoneNotFound => DeleteRouteError::RouteBackendUnavailable,
                RouteError::Rejected => DeleteRouteError::RouteBackendError,
            })?;

        query!("DELETE FROM routes WHERE id = $1", route_id)
            .execute(&*self.database)
            .await?;

        Ok(())
    }
}
