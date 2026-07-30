use crate::Backend;
use crate::auth::effective::EffectivePermissions;
use crate::auth::permissions::{HasPermission, Permission, Role};
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use axum::Extension;
use axum::extract::FromRequestParts as _;
use axum_extra::TypedHeader;
use axum_extra::headers::Authorization;
use axum_extra::headers::authorization::Credentials;
use core::fmt::{Debug, Display, Formatter};
use core::str::FromStr;
use http::header::AUTHORIZATION;
use http::request::Parts;
use http::{HeaderMap, HeaderValue};
use lazy_regex::lazy_regex;
use regex::Regex;
use sha2::{Digest as _, Sha256};
use sqlx::query;
use std::collections::HashMap;
use tracing::error;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

/// Marks a token as one of ours, so a mis-pasted secret is recognisable.
pub const TOKEN_PREFIX: &str = "nvm_";
/// Random part of a token, in characters of the URL-safe alphabet.
const TOKEN_LENGTH: usize = 48;
/// How much of a token is stored in the clear to identify it in the UI.
const DISPLAY_PREFIX_LENGTH: usize = TOKEN_PREFIX.len() + 8;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static API_KEY_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!("Bearer\\s{1,}nvm_[A-Za-z0-9_-]{48}");

/// An authenticated API key, resolved from an `Authorization: Bearer` header.
///
/// The permissions are never read straight from the key: they are the owner's
/// current permissions intersected with the bits the key was created with, so a
/// key follows its owner's access and a project key cannot reach outside its
/// project.
#[derive(Debug)]
pub struct ApiKeyAuthentication {
    pub id: i32,
    /// The user the key belongs to and acts as.
    pub user: i32,
    pub project: Option<ProjectId>,
    permissions: i64,
    projects: HashMap<ProjectId, i64>,
    servers: HashMap<ServerId, i64>,
}

impl ApiKeyAuthentication {
    pub fn has<P: HasPermission<Extra>, Extra>(&self, extra: Extra, permission: P) -> bool {
        permission.has(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn permissions<P: HasPermission<Extra>, Extra>(&self, extra: Extra) -> P {
        P::permissions(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn require<P: Permission<Extra, E>, Extra, E>(
        &self,
        extra: Extra,
        permission: P,
    ) -> Result<(), E> {
        permission.require(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn is_project_member(&self, project: ProjectId) -> bool {
        self.projects.contains_key(&project)
    }
}

/// Whether the request authenticates with an API key rather than a session.
///
/// Sessions use the `Session` scheme (or the cookie), so anything else in the
/// header must not be parsed as one.
pub fn is_api_key_request(headers: &HeaderMap) -> bool {
    headers
        .get(AUTHORIZATION)
        .is_some_and(|value| value.as_bytes().starts_with(ApiKeyToken::SCHEME.as_bytes()))
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync>
    OptionalFromRequestParts<E> for ApiKeyAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Option<Self>, E> {
        if !is_api_key_request(&parts.headers) {
            return Ok(None);
        }

        let Extension(backend) =
            <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(
                parts,
                &(),
            )
            .await
            .expect("Extension not registered");

        let Some(TypedHeader(Authorization(token))) =
            <Option<TypedHeader<Authorization<ApiKeyToken>>>>::from_request_parts(parts, &())
                .await
                .map_err(|_err| <E as FromAuthInvalid>::from())?
        else {
            return Ok(None);
        };

        let mut conn = backend
            .database
            .acquire()
            .await
            .inspect_err(|err| error!("Unable to acquire database connection: {err:?}"))?;

        // Stamping the last use in the lookup keeps it to a single round trip.
        let Some(key) = query!(
            r#"UPDATE api_keys SET last_used = now()
             WHERE token_hash = $1
             RETURNING
                id,
                "user",
                project AS "project: ProjectId",
                permissions"#,
            token.hash()
        )
        .fetch_optional(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch api key: {err:?}"))?
        else {
            return Ok(None);
        };

        let Some(role) = query!(
            r#"SELECT role AS "role: i32" FROM users WHERE id = $1"#,
            key.user
        )
        .fetch_optional(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch owner of api key {}: {err:?}", key.id))?
        else {
            return Ok(None);
        };

        let role = u8::try_from(role.role)
            .ok()
            .and_then(|role| Role::try_from(role).ok());

        let effective = EffectivePermissions::load(&mut conn, key.user, role)
            .await?
            .masked(key.permissions, key.project);

        Ok(Some(Self {
            id: key.id,
            user: key.user,
            project: key.project,
            permissions: effective.permissions,
            projects: effective.projects,
            servers: effective.servers,
        }))
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync> FromRequestParts<E>
    for ApiKeyAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        <Self as OptionalFromRequestParts<E>>::from_request_parts(parts)
            .await?
            .ok_or_else(<E as FromAuthInvalid>::from)
    }
}

/// The secret half of an API key. Only ever stored hashed.
#[repr(transparent)]
#[derive(Clone)]
pub struct ApiKeyToken(String);

impl ApiKeyToken {
    pub fn generate() -> Self {
        Self(format!(
            "{TOKEN_PREFIX}{}",
            nanoid::format(nanoid::rngs::default, &nanoid::alphabet::SAFE, TOKEN_LENGTH,)
        ))
    }

    /// Hex-encoded SHA-256, the form stored in `api_keys.token_hash`.
    pub fn hash(&self) -> String {
        hex::encode(Sha256::digest(self.0.as_bytes()))
    }

    /// The non-secret leading segment shown in the UI.
    pub fn display_prefix(&self) -> String {
        self.0.chars().take(DISPLAY_PREFIX_LENGTH).collect()
    }
}

impl Credentials for ApiKeyToken {
    const SCHEME: &'static str = "Bearer";

    #[expect(
        clippy::indexing_slicing,
        reason = "validated before by `Authorization`"
    )]
    fn decode(value: &HeaderValue) -> Option<Self> {
        let bytes = &value.as_bytes()["Bearer ".len()..];
        let non_space_pos = bytes.iter().position(|byte| *byte != b' ')?;
        let bytes = &bytes[non_space_pos..];
        Self::from_str(core::str::from_utf8(bytes).ok()?).ok()
    }

    fn encode(&self) -> HeaderValue {
        HeaderValue::try_from(self.0.clone()).expect("Unable to encode api key")
    }
}

impl FromStr for ApiKeyToken {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if !value.starts_with(TOKEN_PREFIX)
            || value.len() != TOKEN_PREFIX.len() + TOKEN_LENGTH
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(());
        }

        Ok(Self(value.to_owned()))
    }
}

impl Display for ApiKeyToken {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Debug for ApiKeyToken {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_tuple("ApiKeyToken")
            .field(&self.display_prefix())
            .finish()
    }
}

impl DocumentedType for ApiKeyAuthentication {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(
            ParameterBuilder::new()
                .name("Authorization")
                .parameter_in(ParameterIn::Header)
                .description(Some("The api key"))
                .schema(Some(RefOr::T(Schema::Object(
                    Object::builder()
                        .schema_type(SchemaType::Type(Type::String))
                        .pattern(Some(API_KEY_REGEX.as_str()))
                        .build(),
                ))))
                .required(Required::False),
        )
    }
}
