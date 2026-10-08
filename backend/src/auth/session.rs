use crate::auth::client::ClientInfo;
use crate::{Backend, CACHE_KEY_PREFIX};
use axum::Extension;
use axum_extra::extract::cookie::CookieJar;
use base64::Engine as _;
use base64::prelude::BASE64_URL_SAFE_NO_PAD;
use chrono::{DateTime, TimeDelta, Utc};
use core::fmt::{Debug, Display, Formatter};
use core::str::FromStr;
use core::time::Duration;
use http::HeaderValue;
use http::request::Parts;
use rand::TryRng as _;
use redis::AsyncCommands as _;
use sha2::{Digest as _, Sha256};
use speedy::{Readable, Writable};
use sqlx::query;
use tracing::{debug, error, warn};
use utoipa::openapi::path::{OperationBuilder, Parameter, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use uuid::Uuid;
use zelus::special::FromRequestParts;
use zelus::types::DocumentedType;

pub const SESSION_COOKIE_NAME: &str = "session";

const SESSION_NAMESPACE: &str = "session";
const SESSION_TOKEN_SIZE: usize = 48;
const REFRESH_INTERVAL: TimeDelta = TimeDelta::minutes(1);
const CLEANUP_INTERVAL: Duration = Duration::from_mins(30);

#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct SessionToken([u8; SESSION_TOKEN_SIZE]);

impl SessionToken {
    pub fn generate() -> Result<Self, core::convert::Infallible> {
        let mut bytes = [0; SESSION_TOKEN_SIZE];
        rand::rng().try_fill_bytes(&mut bytes)?;
        Ok(Self(bytes))
    }

    pub fn hash(&self) -> String {
        hex::encode(Sha256::digest(self.0))
    }
}

impl Display for SessionToken {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(&BASE64_URL_SAFE_NO_PAD.encode(self.0))
    }
}

impl Debug for SessionToken {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.debug_tuple("SessionToken").field(&"***").finish()
    }
}

impl FromStr for SessionToken {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let decoded = BASE64_URL_SAFE_NO_PAD
            .decode(value.as_bytes())
            .map_err(|_err| ())?;
        if decoded.len() != SESSION_TOKEN_SIZE {
            return Err(());
        }

        let mut token = [0u8; SESSION_TOKEN_SIZE];
        token.copy_from_slice(&decoded);
        Ok(Self(token))
    }
}

#[derive(Debug, Clone)]
pub struct Session {
    pub id: Uuid,
    pub user: i32,
    hash: String,
}

#[derive(Writable, Readable)]
struct CachedSession {
    id: u128,
    user: i32,
    absolute_expires_at: i64,
    refreshed_at: i64,
}

struct TouchedSession {
    id: Uuid,
    user: i32,
    absolute_expires_at: DateTime<Utc>,
}

fn cache_key(hash: &str) -> String {
    format!("{CACHE_KEY_PREFIX}{SESSION_NAMESPACE}:{hash}")
}

fn cache_ttl(now: DateTime<Utc>, absolute_expires_at: DateTime<Utc>, idle_lifetime: u64) -> u64 {
    (absolute_expires_at - now)
        .num_seconds()
        .max(0)
        .unsigned_abs()
        .min(idle_lifetime)
}

async fn touch<E: From<sqlx::Error>>(
    backend: &Backend,
    hash: &str,
    now: DateTime<Utc>,
) -> Result<Option<TouchedSession>, E> {
    let idle_expiry = now + TimeDelta::seconds(backend.config.session_lifetime.cast_signed());

    let record = query!(
        r#"UPDATE sessions
            SET last_used = $2, expires_at = LEAST($3, absolute_expires_at)
            WHERE token_hash = $1 AND expires_at > $2
            RETURNING id, "user", absolute_expires_at"#,
        hash,
        now,
        idle_expiry
    )
    .fetch_optional(&*backend.database)
    .await
    .inspect_err(|err| error!("Unable to refresh session: {err:?}"))?;

    Ok(record.map(|record| TouchedSession {
        id: record.id,
        user: record.user,
        absolute_expires_at: record.absolute_expires_at,
    }))
}

async fn read_cached(backend: &Backend, key: &str) -> Option<CachedSession> {
    let bytes = backend
        .cache
        .clone()
        .get::<_, Option<Vec<u8>>>(key)
        .await
        .inspect_err(|err| warn!("Unable to read session from cache: {err:?}"))
        .ok()??;

    CachedSession::read_from_buffer(&bytes)
        .inspect_err(|err| warn!("Unable to decode cached session: {err:?}"))
        .ok()
}

async fn write_cached(backend: &Backend, key: &str, entry: &CachedSession, ttl: u64) {
    let Ok(bytes) = entry
        .write_to_vec()
        .inspect_err(|err| warn!("Unable to encode session for the cache: {err:?}"))
    else {
        return;
    };

    let _: Result<(), _> = backend
        .cache
        .clone()
        .set_ex(key, bytes, ttl)
        .await
        .inspect_err(|err| warn!("Unable to cache session: {err:?}"));
}

async fn drop_cached(backend: &Backend, key: &str) {
    let _: Result<(), _> = backend
        .cache
        .clone()
        .del(key)
        .await
        .inspect_err(|err| warn!("Unable to drop session from cache: {err:?}"));
}

impl Session {
    pub async fn authenticate<E: From<sqlx::Error>>(
        token: &SessionToken,
        backend: &Backend,
    ) -> Result<Option<Self>, E> {
        let hash = token.hash();
        let key = cache_key(&hash);
        let now = Utc::now();
        let idle_lifetime = backend.config.session_lifetime;

        if let Some(mut entry) = read_cached(backend, &key).await {
            let expired = DateTime::from_timestamp(entry.absolute_expires_at, 0)
                .is_none_or(|absolute_expires_at| absolute_expires_at <= now);

            if expired {
                Self::purge::<E>(backend, &hash).await?;
                return Ok(None);
            }

            if now.timestamp() - entry.refreshed_at >= REFRESH_INTERVAL.num_seconds() {
                let Some(touched) = touch::<E>(backend, &hash, now).await? else {
                    drop_cached(backend, &key).await;
                    return Ok(None);
                };
                entry.absolute_expires_at = touched.absolute_expires_at.timestamp();
                entry.refreshed_at = now.timestamp();
            }

            let ttl = DateTime::from_timestamp(entry.absolute_expires_at, 0)
                .map_or(idle_lifetime, |absolute_expires_at| {
                    cache_ttl(now, absolute_expires_at, idle_lifetime)
                });
            let session = Self {
                id: Uuid::from_u128(entry.id),
                user: entry.user,
                hash,
            };
            write_cached(backend, &key, &entry, ttl).await;

            return Ok(Some(session));
        }

        let Some(touched) = touch::<E>(backend, &hash, now).await? else {
            return Ok(None);
        };

        write_cached(
            backend,
            &key,
            &CachedSession {
                id: touched.id.as_u128(),
                user: touched.user,
                absolute_expires_at: touched.absolute_expires_at.timestamp(),
                refreshed_at: now.timestamp(),
            },
            cache_ttl(now, touched.absolute_expires_at, idle_lifetime),
        )
        .await;

        Ok(Some(Self {
            id: touched.id,
            user: touched.user,
            hash,
        }))
    }

    async fn purge<E: From<sqlx::Error>>(backend: &Backend, hash: &str) -> Result<(), E> {
        query!("DELETE FROM sessions WHERE token_hash = $1", hash)
            .execute(&*backend.database)
            .await
            .inspect_err(|err| error!("Unable to delete session: {err:?}"))?;

        drop_cached(backend, &cache_key(hash)).await;
        Ok(())
    }

    pub async fn revoke<E: From<sqlx::Error>>(&self, backend: &Backend) -> Result<(), E> {
        Self::purge(backend, &self.hash).await
    }
}

impl Backend {
    pub async fn create_session(
        &self,
        user: i32,
        token: &SessionToken,
        client: &ClientInfo,
    ) -> Result<(), sqlx::Error> {
        let hash = token.hash();
        let now = Utc::now();
        let expires_at = now + TimeDelta::seconds(self.config.session_lifetime.cast_signed());
        let absolute_expires_at =
            now + TimeDelta::seconds(self.config.session_absolute_lifetime.cast_signed());
        let id = Uuid::new_v4();

        query!(
            r#"INSERT INTO sessions
                (id, "user", token_hash, user_agent, ip_address, created_at, last_used, expires_at, absolute_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)"#,
            id,
            user,
            hash,
            client.user_agent.as_deref(),
            client.ip.as_deref(),
            now,
            expires_at,
            absolute_expires_at
        )
        .execute(&*self.database)
        .await
        .inspect_err(|err| error!("Unable to create session: {err:?}"))?;

        write_cached(
            self,
            &cache_key(&hash),
            &CachedSession {
                id: id.as_u128(),
                user,
                absolute_expires_at: absolute_expires_at.timestamp(),
                refreshed_at: now.timestamp(),
            },
            cache_ttl(now, absolute_expires_at, self.config.session_lifetime),
        )
        .await;

        Ok(())
    }

    pub async fn revoke_session<E: From<sqlx::Error>>(
        &self,
        user: i32,
        session: Uuid,
    ) -> Result<bool, E> {
        let Some(record) = query!(
            r#"DELETE FROM sessions WHERE id = $1 AND "user" = $2 RETURNING token_hash"#,
            session,
            user
        )
        .fetch_optional(&*self.database)
        .await
        .inspect_err(|err| error!("Unable to revoke session: {err:?}"))?
        else {
            return Ok(false);
        };

        drop_cached(self, &cache_key(&record.token_hash)).await;
        Ok(true)
    }

    pub async fn revoke_other_sessions<E: From<sqlx::Error>>(
        &self,
        user: i32,
        keep: Uuid,
    ) -> Result<(), E> {
        let records = query!(
            r#"DELETE FROM sessions WHERE "user" = $1 AND id <> $2 RETURNING token_hash"#,
            user,
            keep
        )
        .fetch_all(&*self.database)
        .await
        .inspect_err(|err| error!("Unable to revoke sessions: {err:?}"))?;

        for record in &records {
            drop_cached(self, &cache_key(&record.token_hash)).await;
        }

        Ok(())
    }

    pub fn spawn_session_cleanup(&self) {
        let backend = self.clone();

        tokio::task::spawn(async move {
            loop {
                let pruned = query!("DELETE FROM sessions WHERE expires_at <= now()")
                    .execute(&*backend.database)
                    .await
                    .inspect_err(|err| error!("Unable to prune expired sessions: {err:?}"))
                    .map_or(0, |result| result.rows_affected());

                if pruned > 0 {
                    debug!("Pruned {pruned} expired sessions");
                }

                tokio::time::sleep(CLEANUP_INTERVAL).await;
            }
        });
    }
}

#[derive(Debug)]
pub struct PreviousSession(pub Option<Session>);

impl<E: From<sqlx::Error> + Send + Sync> FromRequestParts<E> for PreviousSession {
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        let Extension(backend) =
            <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(
                parts,
                &(),
            )
            .await
            .expect("Extension not registered");

        let Some(token) = CookieJar::from_headers(&parts.headers)
            .get(SESSION_COOKIE_NAME)
            .and_then(|cookie| SessionToken::from_str(cookie.value()).ok())
        else {
            return Ok(Self(None));
        };

        Ok(Self(Session::authenticate::<E>(&token, &backend).await?))
    }
}

impl DocumentedType for PreviousSession {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(session_cookie_parameter())
    }
}

fn session_cookie_header(backend: &Backend, token: &str, max_age: u64) -> HeaderValue {
    let secure = if backend.config.cookie_secure() {
        "; Secure"
    } else {
        ""
    };
    HeaderValue::try_from(format!(
        "{SESSION_COOKIE_NAME}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{secure}"
    ))
    .expect("session cookie is a valid header value")
}

pub fn set_session_cookie(backend: &Backend, token: &SessionToken) -> HeaderValue {
    session_cookie_header(backend, &token.to_string(), backend.config.session_lifetime)
}

pub fn clear_session_cookie(backend: &Backend) -> HeaderValue {
    session_cookie_header(backend, "", 0)
}

pub fn session_cookie_parameter() -> Parameter {
    ParameterBuilder::new()
        .name(SESSION_COOKIE_NAME)
        .parameter_in(ParameterIn::Cookie)
        .description(Some("The session cookie set on the OAuth callback"))
        .schema(Some(RefOr::T(Schema::Object(
            Object::builder()
                .schema_type(SchemaType::Type(Type::String))
                .build(),
        ))))
        .required(Required::False)
        .build()
}
