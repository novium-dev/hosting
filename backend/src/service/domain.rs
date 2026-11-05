use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions};
use crate::db::project::ProjectId;
use crate::db::route::ProjectRouteDomain;
use crate::routes::acme::delegation_record;
use crate::routes::verify::{VerifyError, generate_token, verification_record};
use crate::routes::{RouteRecord, is_valid_domain};
use crate::service::domain::project_domain_service_error::{
    CreateProjectDomainError, DeleteProjectDomainError, ListProjectDomainsError,
    VerifyProjectDomainError,
};
use crate::service::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{query, query_scalar};
use zelus::service;

const MAX_PROJECT_DOMAINS: i64 = 10;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct DomainCertificateInfo {
    pub(crate) issued_at: Option<DateTime<Utc>>,
    pub(crate) expires_at: Option<DateTime<Utc>>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectDomainInfo {
    pub(crate) id: i32,
    pub(crate) domain: String,
    pub(crate) verified: bool,
    pub(crate) verified_at: Option<DateTime<Utc>>,
    pub(crate) last_checked_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) records: Vec<RouteRecord>,
    pub(crate) certificate: Option<DomainCertificateInfo>,
}

impl ProjectDomainInfo {
    fn new(domain: ProjectRouteDomain, challenge_zone: Option<&str>) -> Self {
        let mut records = Vec::new();

        if domain.verified_at.is_none() {
            records.push(verification_record(
                &domain.domain,
                &domain.verification_token,
            ));
        }

        if let Some(zone) = challenge_zone {
            records.push(delegation_record(&domain.domain, zone));
        }

        let certificate = (domain.certificate_expires_at.is_some()
            || domain.certificate_error.is_some())
        .then_some(DomainCertificateInfo {
            issued_at: domain.certificate_issued_at,
            expires_at: domain.certificate_expires_at,
            error: domain.certificate_error,
        });

        Self {
            id: domain.id,
            verified: domain.verified_at.is_some(),
            verified_at: domain.verified_at,
            last_checked_at: domain.verify_checked_at,
            created_at: domain.created_at,
            domain: domain.domain,
            records,
            certificate,
        }
    }
}

impl Backend {
    fn project_domain_info(&self, domain: ProjectRouteDomain) -> ProjectDomainInfo {
        ProjectDomainInfo::new(
            domain,
            self.config
                .routes
                .acme
                .as_ref()
                .map(|acme| acme.challenge_zone.as_str()),
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectDomainPayload {
    pub(crate) domain: String,
}

fn overlaps(domain: &str, other: &str) -> bool {
    domain == other
        || domain.ends_with(&format!(".{other}"))
        || other.ends_with(&format!(".{domain}"))
}

#[service(path = "/project/{project_id}/domain", tag = "route", no_sdk)]
pub(crate) impl ProjectDomainService for Backend {
    /// Lists the project's own domains.
    ///
    /// `records` lists the DNS records the domain needs: the TXT record proving ownership while
    /// it is unverified, and, when certificates are enabled, the CNAME delegating its ACME
    /// challenges. Certificates are issued for the domain and its wildcard with the email of the
    /// user who added the domain as the ACME contact.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found, db::failure <- [sql:*])]
    async fn list_project_domains(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<Vec<ProjectDomainInfo>, _> {
        auth.require::<_, _, ListProjectDomainsError>(project_id, ProjectPermissions::VIEW)?;

        Ok(self
            .project_route_domains(&*self.database, project_id)
            .await?
            .into_iter()
            .map(|domain| self.project_domain_info(domain))
            .collect())
    }

    /// Adds a domain the project owns.
    ///
    /// The domain stays unverified until the returned TXT record is found in DNS. Pending
    /// domains are checked periodically and removed when they are not verified within a week.
    /// A project may add up to ten domains, or more with
    /// [`ManagementPermissions::LIMITS_BYPASS`].
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DOMAINS_MANAGE`].
    #[route("", method = PUT)]
    #[error(
        auth::{permission_denied, unreachable},
        project::not_found <- [sql:foreign_key],
        route::{domain_invalid, domain_exists, domain_reserved, domain_claimed, domain_limit_exceeded},
        db::failure <- [sql:*]
    )]
    async fn create_project_domain(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        payload: ProjectDomainPayload,
    ) -> Result<ProjectDomainInfo, _> {
        auth.require::<_, _, CreateProjectDomainError>(
            project_id,
            ProjectPermissions::DOMAINS_MANAGE,
        )?;

        let domain = payload.domain.trim().trim_end_matches('.').to_lowercase();
        if !is_valid_domain(&domain) {
            return Err(CreateProjectDomainError::RouteDomainInvalid);
        }

        let domains = self.route_domains(&*self.database).await?;

        if domains
            .iter()
            .any(|other| other.is_platform() && overlaps(&domain, &other.domain))
        {
            return Err(CreateProjectDomainError::RouteDomainReserved);
        }

        if domains
            .iter()
            .any(|other| other.verified && other.domain == domain)
        {
            return Err(CreateProjectDomainError::RouteDomainClaimed);
        }

        if !auth.has((), ManagementPermissions::LIMITS_BYPASS) {
            let count = query_scalar!(
                r#"SELECT COUNT(*) AS "count!" FROM route_domains WHERE project = $1"#,
                &project_id
            )
            .fetch_one(&*self.database)
            .await?;

            if count >= MAX_PROJECT_DOMAINS {
                return Err(CreateProjectDomainError::RouteDomainLimitExceeded);
            }
        }

        let id = query_scalar!(
            r#"INSERT INTO route_domains (domain, project, created_by, verification_token)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (project, domain) WHERE project IS NOT NULL DO NOTHING
               RETURNING id"#,
            domain,
            &project_id,
            auth.user_id(),
            generate_token(),
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(CreateProjectDomainError::RouteDomainExists)?;

        self.project_route_domain(&*self.database, project_id, id)
            .await?
            .map(|domain| self.project_domain_info(domain))
            .ok_or(CreateProjectDomainError::DbFailure)
    }

    /// Checks the domain's verification record right away instead of waiting for the
    /// periodic check.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DOMAINS_MANAGE`].
    #[route("/{domain_id}/verify", method = POST)]
    #[error(
        auth::{permission_denied, unreachable},
        project::not_found,
        route::{domain_not_found, domain_unverified, domain_claimed, backend_unavailable},
        db::failure <- [sql:*]
    )]
    async fn verify_project_domain(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        domain_id: i32,
    ) -> Result<ProjectDomainInfo, _> {
        auth.require::<_, _, VerifyProjectDomainError>(
            project_id,
            ProjectPermissions::DOMAINS_MANAGE,
        )?;

        if self
            .project_route_domain(&*self.database, project_id, domain_id)
            .await?
            .is_none()
        {
            return Err(VerifyProjectDomainError::RouteDomainNotFound);
        }

        self.verify_route_domain(domain_id)
            .await
            .map_err(|err| match err {
                VerifyError::Missing => VerifyProjectDomainError::RouteDomainUnverified,
                VerifyError::Claimed => VerifyProjectDomainError::RouteDomainClaimed,
                VerifyError::Unavailable => VerifyProjectDomainError::RouteBackendUnavailable,
                VerifyError::Database => VerifyProjectDomainError::DbFailure,
            })?;

        self.project_route_domain(&*self.database, project_id, domain_id)
            .await?
            .map(|domain| self.project_domain_info(domain))
            .ok_or(VerifyProjectDomainError::RouteDomainNotFound)
    }

    /// Removes one of the project's domains.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DOMAINS_MANAGE`].
    #[route("/{domain_id}", method = DELETE)]
    #[error(
        auth::{permission_denied, unreachable},
        project::not_found,
        route::{domain_not_found, domain_in_use},
        db::failure <- [sql:*]
    )]
    async fn delete_project_domain(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        domain_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteProjectDomainError>(
            project_id,
            ProjectPermissions::DOMAINS_MANAGE,
        )?;

        if self
            .project_route_domain(&*self.database, project_id, domain_id)
            .await?
            .is_none()
        {
            return Err(DeleteProjectDomainError::RouteDomainNotFound);
        }

        let routes = query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM routes WHERE domain = $1"#,
            domain_id
        )
        .fetch_one(&*self.database)
        .await?;

        if routes > 0 {
            return Err(DeleteProjectDomainError::RouteDomainInUse);
        }

        query!(
            "DELETE FROM route_domains WHERE id = $1 AND project = $2",
            domain_id,
            &project_id
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }
}
