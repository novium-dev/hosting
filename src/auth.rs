use crate::auth::permissions::{HasPermission, Permission};
use crate::auth::user::UserAuthentication;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use http::request::Parts;
use redis::RedisError;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

pub mod oauth;
pub mod oauth_flow;
pub mod permissions;
pub mod user;

#[expect(clippy::large_enum_variant)]
#[derive(Debug)]
pub enum Authentication {
    User(UserAuthentication),
    None,
}

impl Authentication {
    pub fn require<P: Permission<E>, E: FromAuthPermissionDenied>(
        &self,
        extra: P::Extra,
        permission: P,
    ) -> Result<(), E> {
        match self {
            Self::User(auth) => auth.require(extra, permission),
            Self::None => Err(E::from()),
        }
    }

    pub fn has<P: HasPermission>(&self, extra: P::Extra, permission: P) -> bool {
        match self {
            Self::User(auth) => auth.has(extra, permission),
            Self::None => false,
        }
    }
}

impl<E: From<RedisError> + From<sqlx::Error> + FromAuthInvalid + Send + Sync> FromRequestParts<E>
    for Authentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        Ok(
            <UserAuthentication as OptionalFromRequestParts<E>>::from_request_parts(parts)
                .await?
                .map_or_else(|| Self::None, Self::User),
        )
    }
}

impl DocumentedType for Authentication {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(
            ParameterBuilder::new()
                .name("Authorization")
                .parameter_in(ParameterIn::Header)
                .description(Some("The session token or api key"))
                .schema(Some(RefOr::T(Schema::Object(
                    Object::builder()
                        .schema_type(SchemaType::Type(Type::String))
                        .pattern(Some(format!("(?:{})", user::SESSION_REGEX.as_str())))
                        .build(),
                ))))
                .required(Required::False),
        )
    }
}
