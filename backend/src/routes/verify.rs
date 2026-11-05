use crate::Backend;
use crate::cluster::JOB_LOCK_TTL;
use crate::routes::RouteRecord;
use core::time::Duration;
use hickory_resolver::proto::rr::RData;
use hickory_resolver::{ResolverBuilder, TokioResolver};
use sqlx::query;
use tracing::{debug, error, info, warn};

pub const VERIFY_LABEL: &str = "_novium-verify";

const VERIFY_LOCK: &str = "route_domain_verification";

const VERIFY_INTERVAL: Duration = Duration::from_mins(5);

const PENDING_RETENTION_DAYS: i32 = 7;

const VERIFY_RECORD_TTL: u32 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyError {
    Missing,
    Unavailable,
    Claimed,
    Database,
}

impl From<sqlx::Error> for VerifyError {
    fn from(err: sqlx::Error) -> Self {
        error!("Database failure while verifying a route domain: {err:?}");
        Self::Database
    }
}

pub fn verification_name(domain: &str) -> String {
    format!("{VERIFY_LABEL}.{domain}")
}

pub fn verification_record(domain: &str, token: &str) -> RouteRecord {
    RouteRecord {
        record_type: "TXT".to_owned(),
        name: verification_name(domain),
        value: token.to_owned(),
        priority: None,
        port: None,
        ttl: Some(VERIFY_RECORD_TTL),
    }
}

pub fn generate_token() -> String {
    format!("novium-verify={:032x}", rand::random::<u128>())
}

async fn has_token(domain: &str, token: &str) -> Result<bool, VerifyError> {
    let resolver = TokioResolver::builder_tokio()
        .and_then(ResolverBuilder::build)
        .map_err(|err| {
            error!("Unable to create the DNS resolver: {err:?}");
            VerifyError::Unavailable
        })?;

    let lookup = match resolver
        .txt_lookup(format!("{}.", verification_name(domain)))
        .await
    {
        Ok(lookup) => lookup,
        Err(err) if err.is_no_records_found() => return Ok(false),
        Err(err) => {
            warn!("Unable to look the verification record of {domain} up: {err:?}");
            return Err(VerifyError::Unavailable);
        }
    };

    Ok(lookup.answers().iter().any(|record| match record.data {
        RData::TXT(ref txt) => {
            let value = txt
                .txt_data
                .iter()
                .map(|part| String::from_utf8_lossy(part))
                .collect::<String>();
            value.trim() == token
        }
        _ => false,
    }))
}

impl Backend {
    pub(crate) async fn verify_route_domain(&self, domain_id: i32) -> Result<(), VerifyError> {
        let Some(pending) = query!(
            r#"SELECT domain, verification_token AS "verification_token!"
               FROM route_domains
               WHERE id = $1 AND project IS NOT NULL AND verified_at IS NULL"#,
            domain_id
        )
        .fetch_optional(&*self.database)
        .await?
        else {
            return Ok(());
        };

        let found = has_token(&pending.domain, &pending.verification_token).await;

        query!(
            "UPDATE route_domains SET verify_checked_at = now() WHERE id = $1",
            domain_id
        )
        .execute(&*self.database)
        .await?;

        if !found? {
            return Err(VerifyError::Missing);
        }

        let mut tx = self.database.begin().await?;

        let updated = query!(
            "UPDATE route_domains SET verified_at = now() WHERE id = $1 AND verified_at IS NULL",
            domain_id
        )
        .execute(&mut *tx)
        .await;

        match updated {
            Ok(_) => {}
            Err(sqlx::Error::Database(ref err)) if err.is_unique_violation() => {
                return Err(VerifyError::Claimed);
            }
            Err(err) => return Err(err.into()),
        }

        query!(
            r#"DELETE FROM route_domains
               WHERE domain = $1 AND id <> $2 AND verified_at IS NULL AND project IS NOT NULL"#,
            pending.domain,
            domain_id
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        info!("Verified the route domain {}", pending.domain);

        Ok(())
    }

    async fn verify_pending_route_domains(&self) -> Result<(), sqlx::Error> {
        let expired = query!(
            r#"DELETE FROM route_domains
               WHERE project IS NOT NULL
                 AND verified_at IS NULL
                 AND created_at < now() - make_interval(days => $1)
                 AND NOT EXISTS (SELECT 1 FROM routes WHERE routes.domain = route_domains.id)"#,
            PENDING_RETENTION_DAYS
        )
        .execute(&*self.database)
        .await?
        .rows_affected();

        if expired > 0 {
            debug!("Removed {expired} unverified route domains");
        }

        let pending = query!(
            r#"SELECT id FROM route_domains
               WHERE project IS NOT NULL AND verified_at IS NULL
               ORDER BY verify_checked_at NULLS FIRST"#
        )
        .fetch_all(&*self.database)
        .await?;

        for row in pending {
            match self.verify_route_domain(row.id).await {
                Ok(()) | Err(VerifyError::Missing) => {}
                Err(err) => debug!("Unable to verify the route domain {}: {err:?}", row.id),
            }
        }

        Ok(())
    }

    pub(crate) fn spawn_route_domain_verification(&self) {
        let backend = self.clone();

        tokio::task::spawn(async move {
            loop {
                if backend.try_lock(VERIFY_LOCK, JOB_LOCK_TTL).await {
                    let guard = backend.hold_lock(VERIFY_LOCK.to_owned());

                    if let Err(err) = backend.verify_pending_route_domains().await {
                        error!("Unable to verify the pending route domains: {err:?}");
                    }

                    drop(guard);
                    backend.release_lock(VERIFY_LOCK).await;
                }

                tokio::time::sleep(VERIFY_INTERVAL).await;
            }
        });
    }
}
