use crate::Backend;
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
use std::io;
use std::io::ErrorKind;
use zelus::special::{FromRequestParts, OptionalFromRequestParts};

#[derive(Debug)]
pub struct UserAuthentication {
    id: u32,
    session: Session,
}

impl<E: From<RedisError> + FromAuthInvalid + Send + Sync> OptionalFromRequestParts<E>
    for UserAuthentication
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

            Ok(Some(Self { id, session }))
        } else {
            Ok(None)
        }
    }
}

impl<E: From<RedisError> + FromAuthInvalid + Send + Sync> FromRequestParts<E>
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

    pub async fn apply(&self, backend: &mut Backend, user: u32) -> Result<(), RedisError> {
        backend
            .cache
            .set_ex(self.key(), user, backend.config.session_lifetime)
            .await?;
        Ok(())
    }

    pub async fn authenticate(&self, backend: &mut Backend) -> Result<Option<u32>, RedisError> {
        let Some(user) = backend.cache.get_int(self.key()).await? else {
            return Ok(None);
        };
        let user = u32::try_from(user)
            .map_err(|err| RedisError::from(io::Error::new(ErrorKind::InvalidData, err)))?;
        self.apply(backend, user).await?; // refresh the session
        Ok(Some(user))
    }
}

impl Credentials for Session {
    const SCHEME: &'static str = "";

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
