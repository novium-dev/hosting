use crate::Backend;
use crate::service::error_os_failure::FromOsFailure;
use core::time::Duration;
use daemon_common::node::SetupNodeConfig;
use database_agent_common::types::SetupAgentConfig;
use rand::TryRng as _;
use redis::{AsyncCommands as _, ExistenceCheck, RedisError, SetExpiry, SetOptions};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::io;
use tracing::{error, warn};

pub(crate) const REGISTRATION_TIMEOUT: Duration = Duration::from_hours(1);

pub(crate) trait Registration: Serialize + DeserializeOwned + Send + Sync {
    const NAMESPACE: &'static str;
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct NodeRegistration {
    pub(crate) name: String,
    pub(crate) default_host: String,
    pub(crate) config: SetupNodeConfig,
}

impl Registration for NodeRegistration {
    const NAMESPACE: &'static str = "node_registration";
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct DatabaseHostRegistration {
    pub(crate) display: String,
    pub(crate) groups: Vec<String>,
    pub(crate) public_host: String,
    pub(crate) config: SetupAgentConfig,
}

impl Registration for DatabaseHostRegistration {
    const NAMESPACE: &'static str = "database_host_registration";
}

pub(crate) struct Pending<T> {
    pub(crate) code: String,
    pub(crate) registration: T,
    pub(crate) expires_in: u64,
}

fn key<T: Registration>(code: &str) -> String {
    format!("{}{}:{code}", crate::CACHE_KEY_PREFIX, T::NAMESPACE)
}

fn encode<T: Registration>(registration: &T) -> Result<Vec<u8>, RedisError> {
    serde_json::to_vec(registration).map_err(|err| RedisError::from(io::Error::other(err)))
}

fn decode<T: Registration>(raw: Option<Vec<u8>>) -> Option<T> {
    let raw = raw?;
    serde_json::from_slice(&raw)
        .inspect_err(|err| warn!("Discarding unreadable {}: {err:?}", T::NAMESPACE))
        .ok()
}

fn gen_code<E: FromOsFailure>() -> Result<String, E> {
    let mut data = [0u8; 8];
    rand::rng()
        .try_fill_bytes(&mut data)
        .inspect_err(|err| error!("Unable to generate random bytes: {err:?}"))
        .map_err(|_err| <E as FromOsFailure>::from())?;
    Ok(format!(
        "{}-{}-{}-{}",
        hex::encode(&data[0..2]),
        hex::encode(&data[2..4]),
        hex::encode(&data[4..6]),
        hex::encode(&data[6..8])
    ))
}

impl Backend {
    pub(crate) async fn create_registration<T: Registration, E>(
        &self,
        registration: &T,
    ) -> Result<String, E>
    where
        E: FromOsFailure + From<RedisError>,
    {
        let code = gen_code::<E>()?;
        self.cache
            .clone()
            .set_ex::<_, _, ()>(
                key::<T>(&code),
                encode(registration)?,
                REGISTRATION_TIMEOUT.as_secs(),
            )
            .await?;
        Ok(code)
    }

    pub(crate) async fn registration<T: Registration>(
        &self,
        code: &str,
    ) -> Result<Option<T>, RedisError> {
        Ok(decode(
            self.cache
                .clone()
                .get::<_, Option<Vec<u8>>>(key::<T>(code))
                .await?,
        ))
    }

    pub(crate) async fn claim_registration<T: Registration>(
        &self,
        code: &str,
    ) -> Result<Option<T>, RedisError> {
        Ok(decode(
            self.cache
                .clone()
                .get_del::<_, Option<Vec<u8>>>(key::<T>(code))
                .await?,
        ))
    }

    pub(crate) async fn update_registration<T: Registration>(
        &self,
        code: &str,
        registration: &T,
    ) -> Result<bool, RedisError> {
        let options = SetOptions::default()
            .conditional_set(ExistenceCheck::XX)
            .with_expiration(SetExpiry::KEEPTTL);
        Ok(self
            .cache
            .clone()
            .set_options::<_, _, Option<String>>(key::<T>(code), encode(registration)?, options)
            .await?
            .is_some())
    }

    pub(crate) async fn extend_registration<T: Registration>(
        &self,
        code: &str,
    ) -> Result<bool, RedisError> {
        self.cache
            .clone()
            .expire::<_, bool>(key::<T>(code), REGISTRATION_TIMEOUT.as_secs().cast_signed())
            .await
    }

    pub(crate) async fn list_registrations<T: Registration>(
        &self,
    ) -> Result<Vec<Pending<T>>, RedisError> {
        let mut cache = self.cache.clone();
        let prefix = key::<T>("");

        let mut keys = Vec::new();
        {
            let mut iter = cache.scan_match::<_, String>(format!("{prefix}*")).await?;
            while let Some(key) = iter.next_item().await {
                keys.push(key?);
            }
        }

        let mut pending = Vec::with_capacity(keys.len());
        for key in keys {
            let Some(registration) = decode(cache.get::<_, Option<Vec<u8>>>(&key).await?) else {
                continue;
            };
            let ttl = cache.ttl::<_, i64>(&key).await?;
            let Some(code) = key.strip_prefix(&prefix) else {
                continue;
            };
            pending.push(Pending {
                code: code.to_owned(),
                registration,
                expires_in: ttl.max(0).cast_unsigned(),
            });
        }

        pending.sort_by_key(|entry| entry.expires_in);
        Ok(pending)
    }
}
