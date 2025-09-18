use crate::Backend;
use crate::auth::permissions::{HasPermission, Permission, Role, ServerPermissions};
use crate::db::server::ServerId;
use crate::service::error_auth_invalid::FromAuthInvalid;
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
use rand::TryRngCore as _;
use rand::rand_core::OsError;
use rand::rngs::OsRng;
use redis::{AsyncTypedCommands as _, RedisError};
use serde::Serializer as _;
use sqlx::{query, query_scalar};
use std::collections::HashMap;
use std::io;
use std::io::ErrorKind;
use tracing::error;
use zelus::special::{FromRequestParts, OptionalFromRequestParts};

#[derive(Debug)]
pub struct UserAuthentication {
    id: u32,
    session: Session,
    permissions: i64,
    servers: HashMap<ServerId, ServerPermissions>,
}

impl UserAuthentication {
    pub fn has<P: HasPermission>(&self, extra: P::Extra, permission: P) -> bool {
        permission.has(extra, self.permissions, &self.servers)
    }

    pub fn require<P: Permission<E>, E>(&self, extra: P::Extra, permission: P) -> Result<(), E> {
        permission.require(extra, self.permissions, &self.servers)
    }
}

impl<E: From<RedisError> + From<sqlx::Error> + FromAuthInvalid + Send + Sync>
    OptionalFromRequestParts<E> for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Option<Self>, E> {
        let Extension(mut backend) =
            <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(
                parts,
                &(),
            )
            .await
            .expect("Extension not registered");

        if let Some(TypedHeader(Authorization(session))) = <Option<
            TypedHeader<Authorization<Session>>,
        > as axum::extract::FromRequestParts<()>>::from_request_parts(
            parts, &()
        )
        .await
        .map_err(|_err| <E as FromAuthInvalid>::from())?
        {
            let Some(id) = session.authenticate(&mut backend).await? else {
                return Ok(None);
            };

            let mut conn = backend
                .database
                .acquire()
                .await
                .inspect_err(|err| error!("Unable to acquire database connection: {err:?}"))?;

            let Some(user) = query!(
                "SELECT `permissions`,`role` AS `role: u8` FROM `users` WHERE `id` = ?",
                id
            )
            .fetch_optional(&mut *conn)
            .await
            .inspect_err(|err| {
                error!("Unable to fetch permissions for user {id}: {err:?}");
            })?
            else {
                session.invalidate(&mut backend).await?;
                return Ok(None);
            };
            let owned_servers: HashMap<_, _> = query_scalar!(
                "SELECT `id` AS `id: ServerId` FROM `servers` WHERE `owner` = ?",
                id
            )
            .fetch_all(&mut *conn)
            .await
            .inspect_err(|err| {
                error!("Unable to fetch permissions for user {id}: {err:?}");
            })?
            .into_iter()
            .map(|id| (id, ServerPermissions::all()))
            .collect();

            let mut servers: HashMap<ServerId, ServerPermissions> = query!("SELECT `server` AS `server: ServerId`,`permissions` FROM `server_users` WHERE `user` = ?", id)
                .fetch_all(&mut *conn)
                .await
                .inspect_err(|err| error!("Unable to fetch server permissions for user {id}: {err:?}"))?
                .into_iter()
                .map(|record| (record.server, ServerPermissions::from_bits_truncate(record.permissions)))
                .collect();
            servers.extend(owned_servers);

            let role = Role::try_from(user.role).ok();

            Ok(Some(Self {
                id,
                session,
                permissions: user.permissions
                    | role
                        .map(|role| {
                            role.management_permissions().bits() | role.server_permissions().bits()
                        })
                        .unwrap_or_default(),
                servers,
            }))
        } else {
            Ok(None)
        }
    }
}

impl<E: From<RedisError> + From<sqlx::Error> + FromAuthInvalid + Send + Sync> FromRequestParts<E>
    for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        <Self as OptionalFromRequestParts<E>>::from_request_parts(parts)
            .await?
            .ok_or_else(<E as FromAuthInvalid>::from)
    }
}

const SESSION_SIZE: usize = 128;

#[repr(transparent)]
#[derive(Copy, Clone)]
struct Session([u8; SESSION_SIZE]);

impl Session {
    pub fn generate() -> Result<Self, OsError> {
        let mut slice = [0; 128];
        OsRng.try_fill_bytes(&mut slice)?;
        Ok(Self(slice))
    }

    fn key(&self) -> String {
        format!("{}session:{self}", crate::CACHE_PREFIX)
    }

    pub async fn invalidate(&self, backend: &mut Backend) -> Result<(), RedisError> {
        backend
            .cache
            .del(self.key())
            .await
            .inspect_err(|err| error!("Unable to invalidate session: {err:?}"))?;
        Ok(())
    }

    pub async fn apply(&self, backend: &mut Backend, user: u32) -> Result<(), RedisError> {
        backend
            .cache
            .set_ex(self.key(), user, backend.config.session_lifetime)
            .await
            .inspect_err(|err| error!("Unable to apply session: {err:?}"))?;
        Ok(())
    }

    pub async fn authenticate(&self, backend: &mut Backend) -> Result<Option<u32>, RedisError> {
        let Some(user) = backend
            .cache
            .get_int(self.key())
            .await
            .inspect_err(|err| error!("Unable to retrieve session: {err:?}"))?
        else {
            return Ok(None);
        };
        let user = u32::try_from(user)
            .map_err(|err| RedisError::from(io::Error::new(ErrorKind::InvalidData, err)))?;
        self.apply(backend, user).await?; // refresh the session
        Ok(Some(user))
    }
}

impl Credentials for Session {
    const SCHEME: &'static str = "Session";

    fn decode(value: &HeaderValue) -> Option<Self> {
        Self::from_str(value.to_str().ok()?).ok()
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
        let slice = BASE64_STANDARD.decode(value).map_err(|_err| ())?;
        let mut session = [0u8; SESSION_SIZE];
        if slice.len() != SESSION_SIZE {
            return Err(());
        }
        session.copy_from_slice(&slice);
        Ok(Self(session))
    }
}
