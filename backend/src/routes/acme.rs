use crate::Backend;
use crate::cluster::JOB_LOCK_TTL;
use crate::config::AcmeConfig;
use crate::routes::verify::dns_resolver;
use crate::routes::{RouteError, RouteRecord, TxtRecordHandle};
use chrono::{DateTime, Utc};
use core::net::SocketAddr;
use core::time::Duration;
use hickory_resolver::proto::rr::{RData, RecordType};
use instant_acme::{
    Account, AccountCredentials, AuthorizationStatus, ChallengeType, Identifier, LetsEncrypt,
    NewAccount, NewOrder, Order, OrderStatus, RetryPolicy,
};
use sha2::{Digest as _, Sha256};
use sqlx::query;
use tracing::{debug, error, info, warn};

pub const CHALLENGE_LABEL: &str = "_acme-challenge";

const ACCOUNT_DOES_NOT_EXIST: &str = "urn:ietf:params:acme:error:accountDoesNotExist";

const CERTIFICATE_LOCK: &str = "route_domain_certificates";

const CERTIFICATE_INTERVAL: Duration = Duration::from_mins(10);

const RETRY_AFTER_HOURS: i32 = 1;

const PROPAGATION_DELAY: Duration = Duration::from_secs(15);

const ORDER_TIMEOUT: Duration = Duration::from_mins(2);

const DELEGATION_TTL: u32 = 300;

#[derive(Debug)]
pub enum AcmeError {
    Delegation,
    NoOwner,
    Lookup,
    ChallengeZone,
    ChallengeRecords,
    Acme(instant_acme::Error),
    Order(String),
    Certificate,
    Database,
}

impl From<instant_acme::Error> for AcmeError {
    fn from(err: instant_acme::Error) -> Self {
        Self::Acme(err)
    }
}

impl From<sqlx::Error> for AcmeError {
    fn from(err: sqlx::Error) -> Self {
        error!("Database failure while issuing a certificate: {err:?}");
        Self::Database
    }
}

impl AcmeError {
    fn message(&self) -> String {
        match *self {
            Self::Delegation => format!(
                "The {CHALLENGE_LABEL} CNAME record of the domain is missing or points elsewhere"
            ),
            Self::NoOwner => "The user who added the domain no longer exists".to_owned(),
            Self::Lookup => {
                format!("The {CHALLENGE_LABEL} CNAME record of the domain could not be looked up")
            }
            Self::ChallengeZone => {
                "The challenge zone was not found at the DNS provider of this instance".to_owned()
            }
            Self::ChallengeRecords => {
                "The DNS provider of this instance rejected the challenge records".to_owned()
            }
            Self::Acme(instant_acme::Error::Api(ref problem)) => problem
                .detail
                .clone()
                .unwrap_or_else(|| "The certificate authority rejected the request".to_owned()),
            Self::Acme(_) => "The certificate authority could not be reached".to_owned(),
            Self::Order(ref detail) => detail.clone(),
            Self::Certificate => "The issued certificate could not be read".to_owned(),
            Self::Database => "The certificate could not be stored".to_owned(),
        }
    }

    const fn attempted(&self) -> bool {
        !matches!(*self, Self::Delegation | Self::NoOwner)
    }
}

pub fn challenge_target(domain: &str, zone: &str) -> String {
    let digest = Sha256::digest(domain.as_bytes());
    let label = digest.iter().take(8).copied().collect::<Vec<u8>>();
    format!("{}.{zone}", hex::encode(label))
}

pub fn delegation_record(domain: &str, zone: &str) -> RouteRecord {
    RouteRecord {
        record_type: "CNAME".to_owned(),
        name: format!("{CHALLENGE_LABEL}.{domain}"),
        value: challenge_target(domain, zone),
        priority: None,
        port: None,
        ttl: Some(DELEGATION_TTL),
    }
}

async fn has_delegation(
    nameserver: Option<SocketAddr>,
    domain: &str,
    target: &str,
) -> Result<bool, AcmeError> {
    let resolver = dns_resolver(nameserver).ok_or(AcmeError::Lookup)?;

    let lookup = match resolver
        .lookup(format!("{CHALLENGE_LABEL}.{domain}."), RecordType::CNAME)
        .await
    {
        Ok(lookup) => lookup,
        Err(err) if err.is_no_records_found() => return Ok(false),
        Err(err) => {
            warn!("Unable to look the challenge delegation of {domain} up: {err:?}");
            return Err(AcmeError::Lookup);
        }
    };

    Ok(lookup.answers().iter().any(|record| match record.data {
        RData::CNAME(ref cname) => cname
            .0
            .to_string()
            .trim_end_matches('.')
            .eq_ignore_ascii_case(target),
        _ => false,
    }))
}

fn validity(certificate: &str) -> Result<(DateTime<Utc>, DateTime<Utc>), AcmeError> {
    let (_, pem) = x509_parser::pem::parse_x509_pem(certificate.as_bytes())
        .map_err(|_err| AcmeError::Certificate)?;
    let parsed = pem.parse_x509().map_err(|_err| AcmeError::Certificate)?;
    let validity = parsed.validity();

    let issued = DateTime::from_timestamp(validity.not_before.timestamp(), 0)
        .ok_or(AcmeError::Certificate)?;
    let expires = DateTime::from_timestamp(validity.not_after.timestamp(), 0)
        .ok_or(AcmeError::Certificate)?;

    Ok((issued, expires))
}

async fn order_problem(order: &mut Order) -> String {
    let mut authorizations = order.authorizations();
    while let Some(Ok(authorization)) = authorizations.next().await {
        if let Some(detail) = authorization
            .challenges
            .iter()
            .filter_map(|challenge| challenge.error.as_ref())
            .find_map(|problem| problem.detail.clone())
        {
            return detail;
        }
    }

    "The certificate authority did not validate the domain".to_owned()
}

impl Backend {
    fn acme_directory(config: &AcmeConfig) -> String {
        config.directory_url.as_ref().map_or_else(
            || LetsEncrypt::Production.url().to_owned(),
            ToString::to_string,
        )
    }

    async fn acme_account(
        &self,
        config: &AcmeConfig,
        user: i32,
        email: &str,
    ) -> Result<Account, AcmeError> {
        let directory = Self::acme_directory(config);
        let directory = directory.as_str();
        let builder = || {
            config
                .root_ca
                .as_ref()
                .map_or_else(Account::builder, Account::builder_with_root)
        };
        let contact = format!("mailto:{email}");

        let stored = query!(
            r#"SELECT directory_url, email, credentials
               FROM acme_accounts
               WHERE "user" = $1"#,
            user
        )
        .fetch_optional(&*self.database)
        .await?;

        if let Some(stored) = stored
            && stored.directory_url == directory
        {
            let credentials = serde_json::from_value::<AccountCredentials>(stored.credentials)
                .map_err(|err| AcmeError::Acme(instant_acme::Error::Json(err)))?;
            let account = builder()?.from_credentials(credentials).await?;

            if stored.email != email {
                account.update_contacts(&[&contact]).await?;
                query!(
                    r#"UPDATE acme_accounts SET email = $1 WHERE "user" = $2"#,
                    email,
                    user
                )
                .execute(&*self.database)
                .await?;
            }

            return Ok(account);
        }

        let (account, credentials) = builder()?
            .create(
                &NewAccount {
                    contact: &[&contact],
                    terms_of_service_agreed: true,
                    only_return_existing: false,
                },
                directory.to_owned(),
                None,
            )
            .await?;

        query!(
            r#"INSERT INTO acme_accounts ("user", directory_url, email, credentials)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT ("user") DO UPDATE
               SET directory_url = EXCLUDED.directory_url,
                   email = EXCLUDED.email,
                   credentials = EXCLUDED.credentials,
                   created_at = now()"#,
            user,
            directory,
            email,
            serde_json::to_value(&credentials)
                .map_err(|err| AcmeError::Acme(instant_acme::Error::Json(err)))?
        )
        .execute(&*self.database)
        .await?;

        info!("Created an ACME account for user {user}");

        Ok(account)
    }

    async fn complete_order(
        &self,
        order: &mut Order,
        target: &str,
        domain: &str,
        records: &mut Vec<TxtRecordHandle>,
    ) -> Result<(String, String), AcmeError> {
        let comment = format!("ACME challenge for {domain}");

        let mut authorizations = order.authorizations();
        while let Some(result) = authorizations.next().await {
            let mut authorization = result?;
            match authorization.status {
                AuthorizationStatus::Pending => {}
                AuthorizationStatus::Valid => continue,
                status => {
                    return Err(AcmeError::Order(format!(
                        "The authorization for {domain} is {status:?}"
                    )));
                }
            }

            let challenge = authorization
                .challenge(ChallengeType::Dns01)
                .ok_or_else(|| AcmeError::Order("No DNS-01 challenge was offered".to_owned()))?;
            let value = challenge.key_authorization().dns_value();

            records.push(
                self.route_backends
                    .create_txt(target, &value, &comment)
                    .await
                    .map_err(|err| match err {
                        RouteError::ZoneNotFound => {
                            error!("No Cloudflare zone carries the challenge name {target}");
                            AcmeError::ChallengeZone
                        }
                        RouteError::Unavailable
                        | RouteError::Rejected
                        | RouteError::DomainNotLinked => AcmeError::ChallengeRecords,
                    })?,
            );
        }

        if !records.is_empty() {
            tokio::time::sleep(PROPAGATION_DELAY).await;
        }

        let mut authorizations = order.authorizations();
        while let Some(result) = authorizations.next().await {
            let mut authorization = result?;
            if authorization.status != AuthorizationStatus::Pending {
                continue;
            }

            authorization
                .challenge(ChallengeType::Dns01)
                .ok_or_else(|| AcmeError::Order("No DNS-01 challenge was offered".to_owned()))?
                .set_ready()
                .await?;
        }

        let retries = RetryPolicy::new()
            .initial_delay(Duration::from_secs(2))
            .timeout(ORDER_TIMEOUT);

        let status = order.poll_ready(&retries).await?;
        if status != OrderStatus::Ready {
            return Err(AcmeError::Order(order_problem(order).await));
        }

        let private_key = order.finalize().await?;
        let certificate = order.poll_certificate(&retries).await?;

        Ok((certificate, private_key))
    }

    async fn issue_certificate(
        &self,
        config: &AcmeConfig,
        domain_id: i32,
        domain: &str,
        owner: Option<(i32, String)>,
    ) -> Result<(), AcmeError> {
        let (user, email) = owner.ok_or(AcmeError::NoOwner)?;

        let target = challenge_target(domain, &config.challenge_zone);
        if !has_delegation(self.config.routes.dns_resolver, domain, &target).await? {
            return Err(AcmeError::Delegation);
        }

        query!(
            r#"INSERT INTO route_domain_certificates (domain, last_attempt_at)
               VALUES ($1, now())
               ON CONFLICT (domain) DO UPDATE SET last_attempt_at = now()"#,
            domain_id
        )
        .execute(&*self.database)
        .await?;

        let identifiers = [
            Identifier::Dns(domain.to_owned()),
            Identifier::Dns(format!("*.{domain}")),
        ];
        let new_order = NewOrder::new(&identifiers);

        let account = self.acme_account(config, user, &email).await?;
        let mut order = match account.new_order(&new_order).await {
            Err(instant_acme::Error::Api(ref problem))
                if problem.r#type.as_deref() == Some(ACCOUNT_DOES_NOT_EXIST) =>
            {
                warn!("The ACME account of user {user} no longer exists, creating a new one");
                query!(r#"DELETE FROM acme_accounts WHERE "user" = $1"#, user)
                    .execute(&*self.database)
                    .await?;
                self.acme_account(config, user, &email)
                    .await?
                    .new_order(&new_order)
                    .await?
            }
            result => result?,
        };

        let mut records = Vec::new();
        let result = self
            .complete_order(&mut order, &target, domain, &mut records)
            .await;

        for record in &records {
            if let Err(err) = self.route_backends.delete_txt(record).await {
                warn!("Unable to remove an ACME challenge record of {domain}: {err:?}");
            }
        }

        let (certificate, private_key) = result?;
        let (issued, expires) = validity(&certificate)?;

        query!(
            r#"UPDATE route_domain_certificates
               SET certificate_pem = $1,
                   private_key_pem = $2,
                   issued_at = $3,
                   expires_at = $4,
                   last_error = NULL
               WHERE domain = $5"#,
            certificate,
            private_key,
            issued,
            expires,
            domain_id
        )
        .execute(&*self.database)
        .await?;

        info!("Issued a certificate for {domain} valid until {expires}");

        Ok(())
    }

    async fn record_certificate_failure(&self, domain_id: i32, err: &AcmeError) {
        let message = err.message();

        let stored = if err.attempted() {
            query!(
                r#"INSERT INTO route_domain_certificates (domain, last_attempt_at, last_error)
                   VALUES ($1, now(), $2)
                   ON CONFLICT (domain) DO UPDATE
                   SET last_attempt_at = now(), last_error = EXCLUDED.last_error"#,
                domain_id,
                message
            )
            .execute(&*self.database)
            .await
        } else {
            query!(
                r#"INSERT INTO route_domain_certificates (domain, last_error)
                   VALUES ($1, $2)
                   ON CONFLICT (domain) DO UPDATE SET last_error = EXCLUDED.last_error"#,
                domain_id,
                message
            )
            .execute(&*self.database)
            .await
        };

        if let Err(store) = stored {
            error!("Unable to store the certificate failure of domain {domain_id}: {store:?}");
        }
    }

    async fn renew_route_domain_certificates(
        &self,
        config: &AcmeConfig,
    ) -> Result<(), sqlx::Error> {
        let due = query!(
            r#"SELECT
                route_domains.id,
                route_domains.domain,
                users.id AS "user?",
                users.email AS "email?"
               FROM route_domains
               LEFT JOIN users ON users.id = route_domains.created_by
               LEFT JOIN route_domain_certificates certificates
                   ON certificates.domain = route_domains.id
               WHERE route_domains.project IS NOT NULL
                 AND route_domains.verified_at IS NOT NULL
                 AND (
                     certificates.expires_at IS NULL
                     OR certificates.expires_at
                         - (certificates.expires_at - certificates.issued_at) / 3 < now()
                 )
                 AND (
                     certificates.last_attempt_at IS NULL
                     OR certificates.last_attempt_at < now() - make_interval(hours => $1)
                 )
               ORDER BY certificates.expires_at NULLS FIRST"#,
            RETRY_AFTER_HOURS
        )
        .fetch_all(&*self.database)
        .await?;

        for row in due {
            let owner = row.user.zip(row.email);
            if let Err(err) = self
                .issue_certificate(config, row.id, &row.domain, owner)
                .await
            {
                debug!("Unable to issue a certificate for {}: {err:?}", row.domain);
                self.record_certificate_failure(row.id, &err).await;
            }
        }

        Ok(())
    }

    async fn run_certificate_job(&self, config: &AcmeConfig) {
        if !self.try_lock(CERTIFICATE_LOCK, JOB_LOCK_TTL).await {
            return;
        }

        let guard = self.hold_lock(CERTIFICATE_LOCK.to_owned());

        if let Err(err) = self.renew_route_domain_certificates(config).await {
            error!("Unable to renew the route domain certificates: {err:?}");
        }

        drop(guard);
        self.release_lock(CERTIFICATE_LOCK).await;
    }

    pub(crate) fn trigger_route_domain_certificates(&self) {
        let Some(config) = self.config.routes.acme.clone() else {
            return;
        };

        let backend = self.clone();
        tokio::task::spawn(async move { backend.run_certificate_job(&config).await });
    }

    pub(crate) fn spawn_route_domain_certificates(&self) {
        let Some(config) = self.config.routes.acme.clone() else {
            return;
        };

        let backend = self.clone();

        tokio::task::spawn(async move {
            loop {
                backend.run_certificate_job(&config).await;
                tokio::time::sleep(CERTIFICATE_INTERVAL).await;
            }
        });
    }
}
