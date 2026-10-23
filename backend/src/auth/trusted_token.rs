use crate::Backend;
use crate::auth::effective::EffectivePermissions;
use crate::auth::permissions::Role;
use crate::config::TrustedTokenConfig;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use axum::Extension;
use base64::Engine as _;
use base64::prelude::BASE64_URL_SAFE_NO_PAD;
use chrono::Utc;
use core::ops::Deref;
use ed25519_dalek::Signature;
use http::HeaderMap;
use http::header::AUTHORIZATION;
use http::request::Parts;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use sqlx::query;
use tracing::{error, warn};
use zelus::special::OptionalFromRequestParts;

const ALGORITHM: &str = "EdDSA";
const CLOCK_LEEWAY_SECONDS: i64 = 30;
const MAX_LIFETIME_SECONDS: i64 = 600;
const MAX_TOKEN_LENGTH: usize = 4096;

#[derive(Deserialize)]
struct TokenHeader {
    alg: String,
    kid: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    Single(String),
    Multiple(Vec<String>),
}

impl Audience {
    fn contains(&self, audience: &str) -> bool {
        match self {
            Self::Single(value) => value == audience,
            Self::Multiple(values) => values.iter().any(|value| value == audience),
        }
    }
}

#[derive(Deserialize)]
struct TokenClaims {
    iss: String,
    aud: Audience,
    sub: String,
    exp: i64,
    iat: i64,
    nbf: Option<i64>,
}

#[derive(Debug)]
pub struct TrustedTokenAuthentication {
    pub user: i32,
    access: EffectivePermissions,
}

impl Deref for TrustedTokenAuthentication {
    type Target = EffectivePermissions;

    fn deref(&self) -> &Self::Target {
        &self.access
    }
}

fn bearer_jwt(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && token.matches('.').count() == 2).then_some(token)
}

fn decode_segment<T: DeserializeOwned>(segment: &str) -> Option<T> {
    let bytes = BASE64_URL_SAFE_NO_PAD.decode(segment).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn verified_subject(config: &TrustedTokenConfig, token: &str, now: i64) -> Option<String> {
    if token.len() > MAX_TOKEN_LENGTH {
        return None;
    }

    let (signed, signature_segment) = token.rsplit_once('.')?;
    let (header_segment, claims_segment) = signed.split_once('.')?;

    let header: TokenHeader = decode_segment(header_segment)?;
    if header.alg != ALGORITHM {
        return None;
    }
    let key = config.keys.get(&header.kid)?;

    let signature_bytes = BASE64_URL_SAFE_NO_PAD.decode(signature_segment).ok()?;
    let signature = Signature::from_slice(&signature_bytes).ok()?;
    key.verify_strict(signed.as_bytes(), &signature).ok()?;

    let claims: TokenClaims = decode_segment(claims_segment)?;
    let valid = claims.iss == config.issuer
        && claims.aud.contains(&config.audience)
        && !claims.sub.trim().is_empty()
        && claims.exp > now - CLOCK_LEEWAY_SECONDS
        && claims.iat <= now + CLOCK_LEEWAY_SECONDS
        && claims
            .nbf
            .is_none_or(|nbf| nbf <= now + CLOCK_LEEWAY_SECONDS)
        && claims.exp - claims.iat <= MAX_LIFETIME_SECONDS;

    valid.then_some(claims.sub)
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync>
    OptionalFromRequestParts<E> for TrustedTokenAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Option<Self>, E> {
        let Some(token) = bearer_jwt(&parts.headers).map(str::to_owned) else {
            return Ok(None);
        };

        let Extension(backend) =
            <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(
                parts,
                &(),
            )
            .await
            .expect("Extension not registered");

        let Some(config) = backend.config.auth.trusted_token.as_ref() else {
            return Ok(None);
        };

        let Some(subject) = verified_subject(config, &token, Utc::now().timestamp()) else {
            warn!("Rejected trusted token: invalid signature or claims");
            return Err(<E as FromAuthInvalid>::from());
        };

        let auth_id = format!("{}:{subject}", config.provider);

        let mut conn = backend
            .database
            .acquire()
            .await
            .inspect_err(|err| error!("Unable to acquire database connection: {err:?}"))?;

        let Some(user) = query!(
            r#"SELECT id, role AS "role: i32" FROM users WHERE auth_id = $1"#,
            auth_id
        )
        .fetch_optional(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch user for trusted token: {err:?}"))?
        else {
            warn!("Rejected trusted token: no user for subject");
            return Err(<E as FromAuthInvalid>::from());
        };

        let role = Role::from_db(user.role);
        let access = EffectivePermissions::load(&mut conn, user.id, role).await?;

        Ok(Some(Self {
            user: user.id,
            access,
        }))
    }
}
