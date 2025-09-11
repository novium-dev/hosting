use crate::Backend;
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use core::fmt::{Display, Formatter};
use core::str::FromStr;
use rand::TryRngCore as _;
use rand::rand_core::OsError;
use rand::rngs::OsRng;
use redis::{AsyncTypedCommands as _, RedisError};
use serde::Serializer as _;
use std::io;
use std::io::ErrorKind;

const SESSION_SIZE: usize = 128;

#[repr(transparent)]
pub struct Session([u8; SESSION_SIZE]);

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

impl Display for Session {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.serialize_str(&BASE64_STANDARD.encode(self.0))
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
