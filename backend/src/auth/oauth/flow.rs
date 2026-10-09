use crate::service::error_cache_failure::FromCacheFailure;
use crate::{Backend, CACHE_KEY_PREFIX};
use axum_extra::extract::cookie::CookieJar;
use chrono::Duration;
use http::HeaderValue;
use http::request::Parts;
use redis::aio::ConnectionManager;
use redis::{AsyncCommands as _, RedisError};
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use tracing::error;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use zelus::special::FromRequestParts;
use zelus::types::DocumentedType;

const FLOWS_NAMESPACE: &str = "oauth_flows";
const STATE_COOKIE_NAME: &str = "oauth_state";
const STATE_COOKIE_PATH: &str = "/api/auth";

#[derive(Debug, Serialize, Deserialize, Writable, Readable)]
pub(crate) struct OAuthFlow {
    pub(crate) provider: String,
    pub(crate) redirect_url: String,
    pub(crate) state: String,
    pub(crate) verifier: String,
}

impl OAuthFlow {
    pub(crate) async fn insert<E: From<RedisError> + FromCacheFailure>(
        &self,
        expires: Duration,
        cache: &mut ConnectionManager,
    ) -> Result<(), E> {
        let key = format!("{CACHE_KEY_PREFIX}{FLOWS_NAMESPACE}:{}", self.state);

        let data = Writable::write_to_vec(self)
            .inspect_err(|err| error!("Failed to serialize OAuthFlow: {err:?}"))
            .map_err(|_err| <E as FromCacheFailure>::from())?;

        let _: () = cache
            .set_ex(key, data, expires.num_seconds().unsigned_abs())
            .await
            .inspect_err(|err| error!("Failed to insert OAuthFlow into cache: {err:?}"))?;

        Ok(())
    }

    pub(crate) async fn take<E: From<RedisError> + FromCacheFailure>(
        id: &str,
        cache: &mut ConnectionManager,
    ) -> Result<Option<Self>, E> {
        let key = format!("{CACHE_KEY_PREFIX}{FLOWS_NAMESPACE}:{id}");

        let Some(bytes) = cache
            .get_del::<_, Option<Vec<u8>>>(key)
            .await
            .inspect_err(|err| error!("Failed to retrieve OAuthFlow from cache: {err:?}"))?
        else {
            return Ok(None);
        };

        Readable::read_from_buffer(&bytes)
            .inspect_err(|err| {
                error!("Failed to deserialize OAuthFlow: {err:?}");
            })
            .map(Some)
            .map_err(|_err| <E as FromCacheFailure>::from())
    }
}

#[derive(Debug)]
pub struct OAuthStateCookie(pub Option<String>);

impl<E> FromRequestParts<E> for OAuthStateCookie {
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        Ok(Self(
            CookieJar::from_headers(&parts.headers)
                .get(STATE_COOKIE_NAME)
                .map(|cookie| cookie.value().to_owned()),
        ))
    }
}

impl DocumentedType for OAuthStateCookie {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(
            ParameterBuilder::new()
                .name(STATE_COOKIE_NAME)
                .parameter_in(ParameterIn::Cookie)
                .description(Some("The OAuth state set when the login was initiated"))
                .schema(Some(RefOr::T(Schema::Object(
                    Object::builder()
                        .schema_type(SchemaType::Type(Type::String))
                        .build(),
                ))))
                .required(Required::False),
        )
    }
}

fn state_cookie_header(backend: &Backend, state: &str, max_age: i64) -> HeaderValue {
    let secure = if backend.config.cookie_secure() {
        "; Secure"
    } else {
        ""
    };
    HeaderValue::try_from(format!(
        "{STATE_COOKIE_NAME}={state}; HttpOnly; SameSite=Lax; Path={STATE_COOKIE_PATH}; Max-Age={max_age}{secure}"
    ))
    .expect("oauth state cookie is a valid header value")
}

pub fn set_state_cookie(backend: &Backend, state: &str, expires: Duration) -> HeaderValue {
    state_cookie_header(backend, state, expires.num_seconds())
}

pub fn clear_state_cookie(backend: &Backend) -> HeaderValue {
    state_cookie_header(backend, "", 0)
}
