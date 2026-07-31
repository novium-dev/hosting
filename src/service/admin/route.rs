use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::project::ProjectId;
use crate::routes::is_valid_domain;
use crate::service::admin::route::route_admin_service_error::{
    AllowDomainProjectError, CreateRouteDomainError, DeleteRouteDomainError,
    DenyDomainProjectError, ListRouteDomainsAdminError, ListRouteProvidersError,
    UpdateRouteDomainError,
};
use crate::service::*;
use serde::{Deserialize, Serialize};
use sqlx::{query, query_scalar};
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteProviderInfo {
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) requires_provider_domain_id: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteDomainAdminInfo {
    pub(crate) id: i32,
    pub(crate) domain: String,
    pub(crate) provider: String,
    pub(crate) provider_domain_id: Option<String>,
    pub(crate) https: bool,
    pub(crate) private: bool,
    pub(crate) projects: Vec<ProjectId>,
    pub(crate) routes: i64,
    pub(crate) available: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteDomainPayload {
    pub(crate) domain: String,
    pub(crate) provider: String,
    pub(crate) provider_domain_id: Option<String>,
    pub(crate) https: Option<bool>,
    pub(crate) private: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct RouteDomainUpdatePayload {
    pub(crate) provider: Option<String>,
    pub(crate) provider_domain_id: Option<String>,
    pub(crate) https: Option<bool>,
    pub(crate) private: Option<bool>,
}

#[service(path = "/admin/route", tag = "route", no_sdk)]
pub(crate) impl RouteAdminService for Backend {
    /// Lists the route providers configured in the backend config.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_VIEW`].
    #[route("/providers", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_route_providers(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<RouteProviderInfo>, _> {
        auth.require::<_, _, ListRouteProvidersError>((), ManagementPermissions::DOMAINS_VIEW)?;

        Ok(self
            .route_providers
            .iter()
            .map(|(name, provider)| RouteProviderInfo {
                name: name.clone(),
                kind: provider.kind().to_owned(),
                requires_provider_domain_id: provider.requires_provider_domain_id(),
            })
            .collect())
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
                available: self.route_provider(&domain.provider).is_some(),
                id: domain.id,
                domain: domain.domain,
                provider: domain.provider,
                provider_domain_id: domain.provider_domain_id,
                https: domain.https,
                private: domain.private,
                routes,
            });
        }

        Ok(domains)
    }

    /// Registers a new route domain users can create routes under.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::DOMAINS_MANAGE`].
    #[route("/domains", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, route::{domain_invalid, domain_exists, provider_unknown}, db::failure <- [sql:*])]
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

        if self.route_provider(&payload.provider).is_none() {
            return Err(CreateRouteDomainError::RouteProviderUnknown);
        }

        query!(
            r#"INSERT INTO route_domains (domain, provider, provider_domain_id, https, private)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (domain) DO NOTHING
               RETURNING id"#,
            domain,
            payload.provider,
            payload.provider_domain_id,
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
    #[error(auth::{permission_denied, unreachable}, route::{domain_not_found, provider_unknown}, db::failure <- [sql:*])]
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

        let provider = payload.provider.unwrap_or(domain.provider);
        if self.route_provider(&provider).is_none() {
            return Err(UpdateRouteDomainError::RouteProviderUnknown);
        }

        query!(
            r#"UPDATE route_domains
               SET provider = $1, provider_domain_id = $2, https = $3, private = $4
               WHERE id = $5"#,
            provider,
            payload.provider_domain_id.or(domain.provider_domain_id),
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
