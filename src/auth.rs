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

pub mod oauth;
pub mod permissions;
pub mod user;

#[derive(Debug)]
#[expect(clippy::large_enum_variant, reason = "Authentication is only used as a request guard, so the larger size of the User variant is not a concern")]
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

    pub fn project_permissions(
        &self,
        project: crate::db::project::ProjectId,
    ) -> crate::auth::permissions::ServerPermissions {
        match self {
            Self::User(auth) => auth.project_permissions(project),
            Self::None => crate::auth::permissions::ServerPermissions::empty(),
        }
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync> FromRequestParts<E>
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
