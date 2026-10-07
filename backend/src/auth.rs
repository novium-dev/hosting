use crate::auth::api_key::ApiKeyAuthentication;
use crate::auth::permissions::{HasPermission, Permission};
use crate::auth::user::UserAuthentication;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use http::request::Parts;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

pub mod api_key;
pub mod client;
pub mod csrf;
pub mod effective;
pub mod grant;
pub mod oauth;
pub mod permissions;
pub mod session;
pub mod user;

#[derive(Debug)]
pub enum Authentication {
    User(UserAuthentication),
    ApiKey(ApiKeyAuthentication),
    None,
}

impl Authentication {
    pub fn require<P: Permission<Extra, E>, Extra, E: FromAuthPermissionDenied>(
        &self,
        extra: Extra,
        permission: P,
    ) -> Result<(), E> {
        match self {
            Self::User(auth) => auth.require(extra, permission),
            Self::ApiKey(auth) => auth.require(extra, permission),
            Self::None => Err(E::from()),
        }
    }

    pub fn has<P: HasPermission<Extra>, Extra>(&self, extra: Extra, permission: P) -> bool {
        match self {
            Self::User(auth) => auth.has(extra, permission),
            Self::ApiKey(auth) => auth.has(extra, permission),
            Self::None => false,
        }
    }

    pub fn permissions<P: HasPermission<Extra>, Extra>(&self, extra: Extra) -> P {
        match self {
            Self::User(auth) => auth.permissions(extra),
            Self::ApiKey(auth) => auth.permissions(extra),
            Self::None => P::default(),
        }
    }

    pub fn is_project_member(&self, project: crate::db::project::ProjectId) -> bool {
        match self {
            Self::User(auth) => auth.is_project_member(project),
            Self::ApiKey(auth) => auth.is_project_member(project),
            Self::None => false,
        }
    }

    pub const fn user_id(&self) -> Option<i32> {
        match *self {
            Self::User(ref auth) => Some(auth.id),
            Self::ApiKey(ref auth) => Some(auth.user),
            Self::None => None,
        }
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync> FromRequestParts<E>
    for Authentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        if let Some(auth) =
            <UserAuthentication as OptionalFromRequestParts<E>>::from_request_parts(parts).await?
        {
            return Ok(Self::User(auth));
        }

        Ok(
            <ApiKeyAuthentication as OptionalFromRequestParts<E>>::from_request_parts(parts)
                .await?
                .map_or_else(|| Self::None, Self::ApiKey),
        )
    }
}

impl DocumentedType for Authentication {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations
            .parameter(session::session_cookie_parameter())
            .parameter(
                ParameterBuilder::new()
                    .name("Authorization")
                    .parameter_in(ParameterIn::Header)
                    .description(Some("The api key"))
                    .schema(Some(RefOr::T(Schema::Object(
                        Object::builder()
                            .schema_type(SchemaType::Type(Type::String))
                            .pattern(Some(api_key::API_KEY_REGEX.as_str()))
                            .build(),
                    ))))
                    .required(Required::False),
            )
    }
}
