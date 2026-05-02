use crate::Backend;
use crate::auth::oauth::AuthUser;
use crate::auth::permissions::{HasPermission, Permission, Role, ServerPermissions};
use crate::db::server::ServerId;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use axum::Extension;
use axum_extra::TypedHeader;
use axum_extra::headers::Authorization;
use axum_extra::headers::authorization::Credentials;
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use core::fmt::Debug;
use core::fmt::{Display, Formatter};
use core::str::FromStr;
use http::HeaderValue;
use http::request::Parts;
use lazy_regex::lazy_regex;
use rand::TryRngCore as _;
use rand::rngs::{OsError, OsRng};
use redis::{AsyncCommands as _, RedisError};
use regex::Regex;
use serde::{Deserialize, Serialize, Serializer as _};
use sqlx::{query, query_scalar};
use std::collections::HashMap;
use std::io;
use std::io::ErrorKind;
use tracing::error;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::{Object, RefOr, Required, Schema, Type};
use uuid::Uuid;
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

#[derive(Debug)]
pub struct UserAuthentication {
    pub id: Uuid,
    pub session: Session,
    username: String,
    permissions: i64,
    role: Role,
    email: String,
    servers: HashMap<ServerId, ServerPermissions>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SerializedUser {
    pub id: Uuid,
    pub username: String,
    pub permissions: i64,
    pub role: Role,
    pub email: String,
}

impl UserAuthentication {
    pub fn has<P: HasPermission>(&self, extra: P::Extra, permission: P) -> bool {
        permission.has(extra, self.permissions, &self.servers)
    }

    pub fn require<P: Permission<E>, E>(&self, extra: P::Extra, permission: P) -> Result<(), E> {
        permission.require(extra, self.permissions, &self.servers)
    }

    pub fn serialized(&self) -> SerializedUser {
        SerializedUser {
            id: self.id,
            username: self.username.clone(),
            permissions: self.permissions,
            role: self.role,
            email: self.email.clone(),
        }
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync>
    OptionalFromRequestParts<E> for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Option<Self>, E> {
        let Extension(backend) =
            <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(
                parts,
                &(),
            )
            .await
            .expect("Extension not registered");

        let Some(TypedHeader(Authorization(session))) =
            <Option<TypedHeader<Authorization<Session>>>>::from_request_parts(parts, &())
                .await
                .map_err(|_err| <E as FromAuthInvalid>::from())?
        else {
            return Ok(None);
        };

        let Some(id) = session.authenticate::<E>(&backend).await? else {
            return Ok(None);
        };

        let mut conn = backend
            .database
            .acquire()
            .await
            .inspect_err(|err| error!("Unable to acquire database connection: {err:?}"))?;

        let Some(user) = query!(
            "SELECT `username`, `permissions`, `role` AS `role: u8`, `email` FROM `users` WHERE `id` = ?",
            &id
        )
        .fetch_optional(&mut *conn)
        .await
        .inspect_err(|err| {
            error!("Unable to fetch permissions for user {id}: {err:?}");
        })?
        else {
            session.invalidate(&backend).await.map_err(|err| {
                error!("Unable to invalidate missing user session: {err:?}");
                <E as FromAuthUnreachable>::from()
            })?;
            return Ok(None);
        };

        let owned_servers: HashMap<_, _> = query_scalar!(
            "SELECT `id` AS `id: ServerId` FROM `servers` WHERE `owner` = ?",
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| {
            error!("Unable to fetch owned servers for user {id}: {err:?}");
        })?
        .into_iter()
        .map(|id| (id, ServerPermissions::all()))
        .collect();

        let mut servers: HashMap<ServerId, ServerPermissions> = query!(
            "SELECT `server` AS `server: ServerId`, `permissions` FROM `server_users` WHERE `user` = ?",
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch server permissions for user {id}: {err:?}"))?
        .into_iter()
        .map(|record| {
            (
                record.server,
                ServerPermissions::from_bits_truncate(record.permissions),
            )
        })
        .collect();
        servers.extend(owned_servers);

        let role = Role::try_from(user.role).ok();

        Ok(Some(Self {
            id,
            session,
            username: user.username,
            permissions: user.permissions
                | role
                    .map(|role| {
                        role.management_permissions().bits() | role.server_permissions().bits()
                    })
                    .unwrap_or_default(),
            role: role.unwrap_or(Role::User),
            email: user.email,
            servers,
        }))
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync> FromRequestParts<E>
    for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        <Self as OptionalFromRequestParts<E>>::from_request_parts(parts)
            .await?
            .ok_or_else(<E as FromAuthInvalid>::from)
    }
}

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static SESSION_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!("Session\\s{1,}(?:[A-Za-z0-9+\\/]{171})=");
const SESSION_SIZE: usize = 128;

#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct Session([u8; SESSION_SIZE]);

impl Session {
    pub fn generate() -> Result<Self, OsError> {
        let mut slice = [0; SESSION_SIZE];
        OsRng.try_fill_bytes(&mut slice)?;
        Ok(Self(slice))
    }

    fn key(&self) -> String {
        format!("{}session:{self}", crate::CACHE_PREFIX)
    }

    pub async fn invalidate(&self, backend: &Backend) -> Result<(), RedisError> {
        let _: () = backend
            .cache
            .clone()
            .del(self.key())
            .await
            .inspect_err(|err| error!("Unable to invalidate session: {err:?}"))?;
        Ok(())
    }

    pub async fn apply(&self, backend: &Backend, user: Uuid) -> Result<(), RedisError> {
        let _: () = backend
            .cache
            .clone()
            .set_ex(
                self.key(),
                user.to_string(),
                backend.config.session_lifetime,
            )
            .await
            .inspect_err(|err| error!("Unable to apply session: {err:?}"))?;
        Ok(())
    }

    pub async fn authenticate<E: FromAuthUnreachable>(
        &self,
        backend: &Backend,
    ) -> Result<Option<Uuid>, E> {
        let Some(user) = backend
            .cache
            .clone()
            .get::<_, Option<String>>(self.key())
            .await
            .inspect_err(|err| error!("Unable to retrieve session: {err:?}"))
            .map_err(|_err| <E as FromAuthUnreachable>::from())?
        else {
            return Ok(None);
        };

        let user = Uuid::parse_str(&user).map_err(|err| {
            error!("Invalid session user id: {err:?}");
            <E as FromAuthUnreachable>::from()
        })?;
        self.apply(backend, user).await.map_err(|err| {
            error!("Unable to refresh session: {err:?}");
            <E as FromAuthUnreachable>::from()
        })?;
        Ok(Some(user))
    }
}

impl Credentials for Session {
    const SCHEME: &'static str = "Session";

    #[expect(
        clippy::indexing_slicing,
        reason = "validated before by `Authorization`"
    )]
    fn decode(value: &HeaderValue) -> Option<Self> {
        let bytes = &value.as_bytes()["Session ".len()..];
        let non_space_pos = bytes.iter().position(|byte| *byte != b' ')?;
        let bytes = &bytes[non_space_pos..];
        Self::try_from(bytes).ok()
    }

    fn encode(&self) -> HeaderValue {
        HeaderValue::try_from(self.to_string()).expect("Unable to encode session")
    }
}

impl Display for Session {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.serialize_str(&BASE64_STANDARD.encode(self.0))
    }
}

impl Debug for Session {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_tuple("Session")
            .field(&BASE64_STANDARD.encode(self.0))
            .finish()
    }
}

impl FromStr for Session {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::try_from(value.as_bytes())
    }
}

impl<'a> TryFrom<&'a [u8]> for Session {
    type Error = ();

    fn try_from(value: &'a [u8]) -> Result<Self, Self::Error> {
        let slice = BASE64_STANDARD.decode(value).map_err(|_err| ())?;
        let mut session = [0u8; SESSION_SIZE];
        if slice.len() != SESSION_SIZE {
            return Err(());
        }
        session.copy_from_slice(&slice);
        Ok(Self(session))
    }
}

impl DocumentedType for UserAuthentication {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(
            ParameterBuilder::new()
                .name("Authorization")
                .parameter_in(ParameterIn::Header)
                .description(Some("The session token"))
                .schema(Some(RefOr::T(Schema::Object(
                    Object::builder()
                        .schema_type(SchemaType::Type(Type::String))
                        .min_length(Some(180))
                        .pattern(Some(SESSION_REGEX.as_str()))
                        .build(),
                ))))
                .required(Required::False),
        )
    }
}

impl Backend {
    pub async fn get_or_create_user(&self, auth_user: AuthUser) -> Result<Uuid, sqlx::Error> {
        let id = Uuid::new_v4();

        query!(
            r#"
    INSERT INTO `users`
        (`id`, `username`, `auth_id`, `permissions`, `role`, `email`)
    VALUES
        (?, ?, ?, 0, ?, ?)
    ON DUPLICATE KEY UPDATE
        `username` = VALUES(`username`),
        `email` = VALUES(`email`)
    "#,
            &id,
            auth_user.preferred_username,
            auth_user.sub,
            Role::User as u8,
            auth_user.email
        )
        .execute(&*self.database)
        .await?;

        let id = query_scalar!(
            "SELECT `id` AS `id: uuid::fmt::Hyphenated` FROM `users` WHERE `auth_id` = ?",
            auth_user.sub
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(id.into_uuid())
    }
}
