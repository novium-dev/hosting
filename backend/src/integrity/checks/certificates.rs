use crate::Backend;
use crate::integrity::{Check, CheckError};
use chrono::{TimeDelta, Utc};
use daemon_common::integrity::{IntegrityCategory, IntegrityFinding};
use sqlx::query;
use zelus::async_trait;

const EXPIRY_WARNING_DAYS: i64 = 14;

pub(crate) struct Certificates;

#[async_trait]
impl Check for Certificates {
    fn id(&self) -> &'static str {
        "certificates"
    }

    fn title(&self) -> &'static str {
        "Project domains carry a valid certificate"
    }

    fn description(&self) -> &'static str {
        "Every verified project domain needs a certificate for itself and its wildcard, issued \
         and renewed through ACME. A domain without one, with an expired or soon expiring one, \
         or whose last issuance failed is reported."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Configuration
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        if backend.config.routes.acme.is_none() {
            return Err(CheckError::Skipped(
                "Certificates for project domains are not enabled".to_owned(),
            ));
        }

        let rows = query!(
            r#"SELECT
                   route_domains.domain,
                   route_domains.project AS "project!",
                   certificates.expires_at AS "expires_at?",
                   certificates.last_error AS "last_error?"
               FROM route_domains
               LEFT JOIN route_domain_certificates certificates
                   ON certificates.domain = route_domains.id
               WHERE route_domains.project IS NOT NULL
                 AND route_domains.verified_at IS NOT NULL
               ORDER BY route_domains.domain"#
        )
        .fetch_all(&*backend.database)
        .await?;

        if rows.is_empty() {
            return Err(CheckError::Skipped(
                "No project domain is verified on this instance".to_owned(),
            ));
        }

        let now = Utc::now();
        let warning_threshold = now + TimeDelta::days(EXPIRY_WARNING_DAYS);
        let mut findings = Vec::new();

        for row in rows {
            let finding = match row.expires_at {
                None => Some(IntegrityFinding::warning(
                    "The domain has no certificate yet",
                )),
                Some(expires) if expires <= now => Some(
                    IntegrityFinding::error("The domain's certificate has expired")
                        .with_detail("expired_at", expires.to_rfc3339()),
                ),
                Some(expires) if expires <= warning_threshold => Some(
                    IntegrityFinding::warning("The domain's certificate expires soon")
                        .with_detail("expires_at", expires.to_rfc3339()),
                ),
                Some(_) => row
                    .last_error
                    .is_some()
                    .then(|| IntegrityFinding::warning("The last certificate renewal failed")),
            };

            if let Some(mut finding) = finding {
                finding = finding
                    .with_subject(row.domain)
                    .with_detail("project", row.project);
                if let Some(error) = row.last_error {
                    finding = finding.with_detail("error", error);
                }
                findings.push(finding);
            }
        }

        Ok(findings)
    }
}
