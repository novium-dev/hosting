use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::project::ProjectId;
use crate::routes::{RouteKind, is_valid_domain};
use crate::service::admin::route::route_admin_service_error::{
    AllowDomainProjectError, CreateRouteDomainError, DeleteRouteDomainError,
    DenyDomainProjectError, ListRouteDomainsAdminError, RouteBackendsError, UpdateRouteDomainError,
};
use crate::service::*;
use serde::{Deserialize, Serialize};
use sqlx::{query, query_scalar};
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteBackendInfo {
    pub(crate) cloudflare: bool,
    pub(crate) pangolin: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the domain's flags in the api response"
)]
pub(crate) struct RouteDomainAdminInfo {
    pub(crate) id: i32,
    pub(crate) domain: String,
    pub(crate) pangolin_domain_id: Option<String>,
    pub(crate) https: bool,
    pub(crate) private: bool,
    pub(crate) projects: Vec<ProjectId>,
    pub(crate) routes: i64,
    pub(crate) http_available: bool,
    pub(crate) tcp_available: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteDomainPayload {
    pub(crate) domain: String,
    pub(crate) pangolin_domain_id: Option<String>,
    pub(crate) https: Option<bool>,
    pub(crate) private: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteDomainUpdatePayload {
    pub(crate) pangolin_domain_id: Option<String>,
    pub(crate) https: Option<bool>,
    pub(crate) private: Option<bool>,
}

#[service(path = "/admin/route", tag = "route", no_sdk)]
pub(crate) impl RouteAdminService for Backend {
    /// Reports which route backends the backend config provides.
    ///
    /// Cloudflare carries TCP routes (SRV records), Pangolin carries HTTP routes.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_VIEW`].
    #[route("/backends", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn route_backends(&self, #[special] auth: Authentication) -> Result<RouteBackendInfo, _> {
        auth.require::<_, _, RouteBackendsError>((), ManagementPermissions::DOMAINS_VIEW)?;

        Ok(RouteBackendInfo {
            cloudflare: self.route_backends.supports(RouteKind::Tcp),
            pangolin: self.route_backends.supports(RouteKind::Http),
        })
    }

    /// Lists every route domain on this instance.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_VIEW`].
    #[route("/domains", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_route_domains_admin(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<RouteDomainAdminInfo>, _> {
        auth.require::<_, _, ListRouteDomainsAdminError>((), ManagementPermissions::DOMAINS_VIEW)?;

        let mut domains = Vec::new();
        for domain in self.route_domains(&*self.database).await? {
            let routes = query_scalar!(
                r#"SELECT COUNT(*) AS "count!" FROM routes WHERE domain = $1"#,
                domain.id
            )
            .fetch_one(&*self.database)
            .await?;

            domains.push(RouteDomainAdminInfo {
                projects: self
                    .route_domain_projects(&*self.database, domain.id)
                    .await?,
                http_available: self.route_backends.supports(RouteKind::Http)
                    && domain.pangolin_domain_id.is_some(),
                tcp_available: self.route_backends.supports(RouteKind::Tcp),
                id: domain.id,
                domain: domain.domain,
                pangolin_domain_id: domain.pangolin_domain_id,
                https: domain.https,
                private: domain.private,
                routes,
            });
        }

        Ok(domains)
    }

    /// Registers a new route domain users can create routes under.
    ///
    /// `pangolin_domain_id` links the domain to its Pangolin domain and is required before
    /// HTTP routes can be created under it. TCP routes only need Cloudflare to be configured.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_MANAGE`].
    #[route("/domains", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, route::{domain_invalid, domain_exists}, db::failure <- [sql:*])]
    async fn create_route_domain(
        &self,
        #[special] auth: Authentication,
        payload: RouteDomainPayload,
    ) -> Result<i32, _> {
        auth.require::<_, _, CreateRouteDomainError>((), ManagementPermissions::DOMAINS_MANAGE)?;

        let domain = payload.domain.trim().to_lowercase();
        if !is_valid_domain(&domain) {
            return Err(CreateRouteDomainError::RouteDomainInvalid);
        }

        query!(
            r#"INSERT INTO route_domains (domain, pangolin_domain_id, https, private)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (domain) DO NOTHING
               RETURNING id"#,
            domain,
            payload.pangolin_domain_id,
            payload.https.unwrap_or(true),
            payload.private.unwrap_or(false),
        )
        .fetch_optional(&*self.database)
        .await?
        .map(|row| row.id)
        .ok_or(CreateRouteDomainError::RouteDomainExists)
    }

    /// Updates a route domain.
    ///
    /// Existing routes keep the settings they were provisioned with.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_MANAGE`].
    #[route("/domains/{domain_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, route::domain_not_found, db::failure <- [sql:*])]
    async fn update_route_domain(
        &self,
        #[special] auth: Authentication,
        domain_id: i32,
        payload: RouteDomainUpdatePayload,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateRouteDomainError>((), ManagementPermissions::DOMAINS_MANAGE)?;

        let domain = self
            .route_domain(&*self.database, domain_id)
            .await?
            .ok_or(UpdateRouteDomainError::RouteDomainNotFound)?;

        query!(
            r#"UPDATE route_domains
               SET pangolin_domain_id = $1, https = $2, private = $3
               WHERE id = $4"#,
            payload.pangolin_domain_id.or(domain.pangolin_domain_id),
            payload.https.unwrap_or(domain.https),
            payload.private.unwrap_or(domain.private),
            domain_id,
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }

    /// Deletes a route domain.
    ///
    /// A domain that still has routes cannot be deleted.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_MANAGE`].
    #[route("/domains/{domain_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, route::{domain_not_found, domain_in_use}, db::failure <- [sql:*])]
    async fn delete_route_domain(
        &self,
        #[special] auth: Authentication,
        domain_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteRouteDomainError>((), ManagementPermissions::DOMAINS_MANAGE)?;

        if self
            .route_domain(&*self.database, domain_id)
            .await?
            .is_none()
        {
            return Err(DeleteRouteDomainError::RouteDomainNotFound);
        }

        let routes = query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM routes WHERE domain = $1"#,
            domain_id
        )
        .fetch_one(&*self.database)
        .await?;

        if routes > 0 {
            return Err(DeleteRouteDomainError::RouteDomainInUse);
        }

        query!("DELETE FROM route_domains WHERE id = $1", domain_id)
            .execute(&*self.database)
            .await?;

        Ok(())
    }

    /// Grants a project access to a private route domain.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_MANAGE`].
    #[route("/domains/{domain_id}/projects/{project_id}", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, route::domain_not_found, project::not_found <- [sql:foreign_key], db::failure <- [sql:*])]
    async fn allow_domain_project(
        &self,
        #[special] auth: Authentication,
        domain_id: i32,
        project_id: ProjectId,
    ) -> Result<(), _> {
        auth.require::<_, _, AllowDomainProjectError>((), ManagementPermissions::DOMAINS_MANAGE)?;

        if self
            .route_domain(&*self.database, domain_id)
            .await?
            .is_none()
        {
            return Err(AllowDomainProjectError::RouteDomainNotFound);
        }

        query!(
            r#"INSERT INTO route_domain_projects (domain, project)
               VALUES ($1, $2)
               ON CONFLICT (domain, project) DO NOTHING"#,
            domain_id,
            &project_id,
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }

    /// Revokes a project's access to a private route domain.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_MANAGE`].
    #[route("/domains/{domain_id}/projects/{project_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn deny_domain_project(
        &self,
        #[special] auth: Authentication,
        domain_id: i32,
        project_id: ProjectId,
    ) -> Result<(), _> {
        auth.require::<_, _, DenyDomainProjectError>((), ManagementPermissions::DOMAINS_MANAGE)?;

        query!(
            "DELETE FROM route_domain_projects WHERE domain = $1 AND project = $2",
            domain_id,
            &project_id,
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }
}
