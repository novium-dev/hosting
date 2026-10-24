use crate::Backend;
use crate::auth::effective::UserAccess;
use crate::config::TrustedTokenConfig;
use crate::service::error_auth_invalid::FromAuthInvalid;
use axum::Extension;
use chrono::Utc;
use http::HeaderMap;
use http::header::AUTHORIZATION;
use http::request::Parts;
use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use serde::Deserialize;
use sqlx::query;
use tracing::{error, warn};

const CLOCK_LEEWAY_SECONDS: u64 = 30;
const MAX_LIFETIME_SECONDS: i64 = 600;
const MAX_TOKEN_LENGTH: usize = 4096;

#[derive(Deserialize)]
struct TokenClaims {
    sub: String,
    iat: i64,
    exp: i64,
}

pub fn validation(issuer: &str, audience: &str) -> Validation {
    let mut validation = Validation::new(Algorithm::EdDSA);
    validation.leeway = CLOCK_LEEWAY_SECONDS;
    validation.validate_nbf = true;
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation
}

fn bearer_jwt(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && token.matches('.').count() == 2).then_some(token)
}

fn verified_subject(config: &TrustedTokenConfig, token: &str, now: i64) -> Option<String> {
    if token.len() > MAX_TOKEN_LENGTH {
        return None;
    }

    let key = config.keys.get(&decode_header(token).ok()?.kid?)?;
    let claims = decode::<TokenClaims>(token, key, &config.validation)
        .ok()?
        .claims;

    let valid = !claims.sub.trim().is_empty()
        && claims.iat <= now.saturating_add_unsigned(CLOCK_LEEWAY_SECONDS)
        && claims
            .exp
            .checked_sub(claims.iat)
            .is_some_and(|lifetime| lifetime <= MAX_LIFETIME_SECONDS);

    valid.then_some(claims.sub)
}

pub async fn authenticate<E: From<sqlx::Error> + FromAuthInvalid>(
    parts: &mut Parts,
) -> Result<Option<UserAccess>, E> {
    let Some(token) = bearer_jwt(&parts.headers).map(str::to_owned) else {
        return Ok(None);
    };

    let Extension(backend) =
        <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(parts, &())
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

    Ok(Some(UserAccess::load(&mut conn, user.id, user.role).await?))
}
