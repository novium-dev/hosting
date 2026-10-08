use crate::auth::api_key::ApiKeyAuthentication;
use crate::auth::effective::EffectivePermissions;
use crate::auth::permissions::{Resolve, Scope};
use crate::auth::user::UserAuthentication;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use http::request::Parts;
use utoipa::openapi::path::OperationBuilder;
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
    fn access(&self) -> Option<&EffectivePermissions> {
        match self {
            Self::User(auth) => Some(auth),
            Self::ApiKey(auth) => Some(auth),
            Self::None => None,
        }
    }

    pub fn require<P: Resolve<S>, S: Scope<E>, E: FromAuthPermissionDenied>(
        &self,
        scope: S,
        permission: P,
    ) -> Result<(), E> {
        self.access().map_or_else(
            || Err(E::from()),
            |access| access.require(scope, permission),
        )
    }

    pub fn has<P: Resolve<S>, S>(&self, scope: S, permission: P) -> bool {
        self.access()
            .is_some_and(|access| access.has(scope, permission))
    }

    pub fn permissions<P: Resolve<S>, S>(&self, scope: S) -> P {
        self.access()
            .map(|access| access.permissions(scope))
            .unwrap_or_default()
    }

    pub fn is_project_member(&self, project: crate::db::project::ProjectId) -> bool {
        self.access()
            .is_some_and(|access| access.is_project_member(project))
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
            .parameter(api_key::api_key_parameter())
    }
}
