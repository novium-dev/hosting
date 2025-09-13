use crate::auth::user::UserAuthentication;
use crate::service::error_auth_invalid::FromAuthInvalid;
use daemon_framework::special::{FromRequestParts, OptionalFromRequestParts};
use http::request::Parts;
use redis::RedisError;

mod user;

#[derive(Debug)]
pub enum Authentication {
    User(UserAuthentication),
    None,
}

impl<E: From<RedisError> + FromAuthInvalid + Send + Sync> FromRequestParts<E> for Authentication {
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        Ok(
            <UserAuthentication as OptionalFromRequestParts<E>>::from_request_parts(parts)
                .await?
                .map_or_else(|| Self::None, Self::User),
        )
    }
}
