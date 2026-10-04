pub mod games;
pub mod generic;
mod utils;
pub mod variable;

use crate::db::license::License;
use crate::db::server::ports::{NetworkProtocol, ServerPort};
use crate::service::template::error_template_corrupted::FromTemplateCorrupted;
use crate::service::template::error_template_unavailable::FromTemplateUnavailable;
use async_trait::async_trait;
use core::future::Future;
use core::time::Duration;
pub use daemon_common::service::server::ServerBuildPayload;
pub use redis::aio::ConnectionManager;
use redis::{AsyncCommands as _, RedisError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use speedy::{LittleEndian, Readable, Writable};
use std::collections::{HashMap, HashSet};
use std::io;
use tracing::{debug, error, info};
use variable::VariablePayload;

pub const STARTUP_COMMAND_ENVIRONMENT: &str = "STARTUP_COMMAND";
pub const ENV_FILE_ENVIRONMENT: &str = "ENV_FILE";

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TemplatePortDefinition {
    pub protocol: NetworkProtocol,
    pub internal_port: u16,
    pub placeholder: String,
    pub remappable: bool,
    pub http: bool,
}

pub trait Template {
    const ID: &'static str;
    type Extra: Serialize + for<'a> Deserialize<'a> + Send + Sync;
    type Cache: for<'a> Readable<'a, LittleEndian> + Writable<LittleEndian> + Send + Sync + 'static;

    fn extra_to_build_payload(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> impl Future<Output = Result<ServerBuildPayload, TemplateError>> + Send + Sync;

    fn default_extra(
        &self,
        cache: &Self::Cache,
    ) -> impl Future<Output = Result<Self::Extra, ThinTemplateError>> + Send + Sync;

    fn default_ports(
        &self,
    ) -> impl Future<Output = Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError>>
    + Send
    + Sync;

    fn extra_to_variables(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> impl Future<Output = Result<VariablePayload, TemplateError>> + Send + Sync;

    fn variables_to_extra_validated(
        &self,
        cache: &Self::Cache,
        old_extra: Self::Extra,
        variables: HashMap<String, String>,
    ) -> impl Future<Output = Result<Option<Self::Extra>, TemplateError>> + Send + Sync;

    fn enabled_features(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> impl Future<Output = Result<HashSet<&'static str>, TemplateError>> + Send + Sync;

    fn default_internet_access(&self) -> bool;

    fn supports_custom_environment(&self) -> bool {
        false
    }

    fn licenses(&self) -> &'static [&'static License] {
        &[]
    }

    fn primary_port(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
        _ports: &HashMap<u32, ServerPort>,
    ) -> impl Future<Output = Option<(u32, ServerPort, u16)>> + Send + Sync {
        async { None }
    }

    fn primary_port0(
        &self,
        ports: &HashMap<u32, ServerPort>,
        required_internal_port: u16,
        protocol: NetworkProtocol,
    ) -> impl Future<Output = Option<(u32, ServerPort, u16)>> + Send + Sync {
        async move {
            ports
                .iter()
                .filter(|(_id, port)| port.protocol == protocol)
                .flat_map(move |(id, port)| {
                    port.external_port.clone().map(move |external_port| {
                        (
                            id,
                            external_port,
                            port.internal_port + (external_port - port.external_port.start()),
                            port,
                        )
                    })
                })
                .find(|(_, _, internal_port, _)| *internal_port == required_internal_port)
                .map(|(id, external_port, _, port)| (*id, port.clone(), external_port))
        }
    }

    fn primary_port_named(
        &self,
        ports: &HashMap<u32, ServerPort>,
        name: &'static str,
    ) -> impl Future<Output = Option<(u32, ServerPort, u16)>> + Send + Sync {
        async move {
            ports
                .iter()
                .find(|(_id, port)| port.name == name)
                .map(|(id, port)| (*id, port.clone(), *port.external_port.start()))
        }
    }

    fn init(
        &self,
        cache_client: ConnectionManager,
    ) -> impl Future<Output = Result<(), RedisError>> + Send + Sync;

    fn update_cache() -> impl Future<Output = Result<Self::Cache, ()>> + Send + Sync;

    fn cache_update_needed(cache: &Self::Cache) -> bool;
}

#[async_trait]
pub trait TemplateInner {
    fn id(&self) -> &'static str;

    async fn extra_to_build_payload(
        &self,
        cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<ServerBuildPayload, TemplateError>;

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError>;

    async fn default_extra(
        &self,
        cache_client: ConnectionManager,
    ) -> Result<Value, ThinTemplateError>;

    async fn extra_to_variables(
        &self,
        cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<VariablePayload, TemplateError>;

    async fn default_variables(
        &self,
        cache_client: ConnectionManager,
    ) -> Result<VariablePayload, ThinTemplateError>;

    async fn variables_to_extra_validated(
        &self,
        cache_client: ConnectionManager,
        old_extra: Value,
        variables: HashMap<String, String>,
    ) -> Result<Option<Value>, TemplateError>;

    async fn enabled_features(
        &self,
        cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<HashSet<&'static str>, TemplateError>;

    async fn primary_port(
        &self,
        cache_client: ConnectionManager,
        extra: Value,
        ports: &HashMap<u32, ServerPort>,
    ) -> Result<Option<(u32, ServerPort, u16)>, TemplateError>;

    async fn init(
        &self,
        cache_client: ConnectionManager,
        skip_cache_update: bool,
    ) -> Result<(), RedisError>;

    async fn refresh_cache(&self, cache_client: ConnectionManager) -> Result<(), io::Error>;

    fn default_internet_access(&self) -> bool;

    fn supports_custom_environment(&self) -> bool;

    fn licenses(&self) -> &'static [&'static License];
}

async fn load_cache<'a, T: Readable<'a, LittleEndian> + Send + Sync>(
    cache: &mut ConnectionManager,
    id: &'static str,
) -> Result<Option<T>, RedisError> {
    let key = format!("{}template:{}", crate::CACHE_KEY_PREFIX, id);
    if !cache.exists::<_, bool>(&key).await? {
        return Ok(None);
    }
    let value: Vec<u8> = cache.get(&key).await?;
    match T::read_from_buffer_copying_data(&value) {
        Ok(val) => Ok(Some(val)),
        Err(_err) => Ok(None),
    }
}

async fn load_cache_required<
    'a,
    E: From<RedisError> + FromTemplateUnavailable,
    T: Readable<'a, LittleEndian> + Send + Sync,
>(
    cache: &mut ConnectionManager,
    id: &'static str,
) -> Result<T, E> {
    load_cache(cache, id)
        .await?
        .map_or_else(|| Err(<E as FromTemplateUnavailable>::from()), Ok)
}

async fn save_cache<T: Writable<LittleEndian> + Send + Sync>(
    cache: &mut ConnectionManager,
    id: &'static str,
    obj: &T,
) -> Result<(), io::Error> {
    let key = format!("{}template:{}", crate::CACHE_KEY_PREFIX, id);
    cache
        .set::<_, _, ()>(&key, obj.write_to_vec().map_err(io::Error::other)?)
        .await
        .map_err(io::Error::other)?;
    Ok(())
}

#[derive(Debug)]
pub enum TemplateError {
    Corrupted,
    Unavailable,
    Redis(RedisError),
}

#[derive(Debug)]
pub enum ThinTemplateError {
    Unavailable,
    Redis(RedisError),
}

impl From<RedisError> for TemplateError {
    fn from(value: RedisError) -> Self {
        Self::Redis(value)
    }
}

impl From<RedisError> for ThinTemplateError {
    fn from(value: RedisError) -> Self {
        Self::Redis(value)
    }
}

impl TemplateError {
    pub fn into<E: FromTemplateCorrupted + FromTemplateUnavailable + From<RedisError>>(self) -> E {
        match self {
            Self::Corrupted => <E as FromTemplateCorrupted>::from(),
            Self::Unavailable => <E as FromTemplateUnavailable>::from(),
            Self::Redis(redis) => <E as From<RedisError>>::from(redis),
        }
    }
}

impl ThinTemplateError {
    pub fn into<E: FromTemplateUnavailable + From<RedisError>>(self) -> E {
        match self {
            Self::Unavailable => <E as FromTemplateUnavailable>::from(),
            Self::Redis(redis) => <E as From<RedisError>>::from(redis),
        }
    }
}

impl FromTemplateUnavailable for TemplateError {
    fn from() -> Self
    where
        Self: Sized,
    {
        Self::Unavailable
    }
}
impl FromTemplateUnavailable for ThinTemplateError {
    fn from() -> Self
    where
        Self: Sized,
    {
        Self::Unavailable
    }
}

#[async_trait]
impl<T: Template + Send + Sync> TemplateInner for T {
    fn id(&self) -> &'static str {
        <Self as Template>::ID
    }

    async fn extra_to_build_payload(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<ServerBuildPayload, TemplateError> {
        let extra: <Self as Template>::Extra =
            serde_json::from_value(extra).map_err(|_err| TemplateError::Corrupted)?;
        self.extra_to_build_payload(
            &load_cache_required::<TemplateError, _>(&mut cache_client, self.id()).await?,
            extra,
        )
        .await
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        <Self as Template>::default_ports(self).await
    }

    async fn default_extra(
        &self,
        mut cache_client: ConnectionManager,
    ) -> Result<Value, ThinTemplateError> {
        Ok(serde_json::to_value(
            &<Self as Template>::default_extra(
                self,
                &load_cache_required::<ThinTemplateError, _>(&mut cache_client, self.id()).await?,
            )
            .await?,
        )
        .expect("Unable to serialize default extra"))
    }

    async fn extra_to_variables(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<VariablePayload, TemplateError> {
        let extra: <Self as Template>::Extra =
            serde_json::from_value(extra).map_err(|_err| TemplateError::Corrupted)?;
        <Self as Template>::extra_to_variables(
            self,
            &load_cache_required::<TemplateError, _>(&mut cache_client, self.id()).await?,
            extra,
        )
        .await
    }

    async fn default_variables(
        &self,
        mut cache_client: ConnectionManager,
    ) -> Result<VariablePayload, ThinTemplateError> {
        let cache =
            load_cache_required::<ThinTemplateError, _>(&mut cache_client, self.id()).await?;
        <Self as Template>::extra_to_variables(
            self,
            &cache,
            <Self as Template>::default_extra(self, &cache).await?,
        ).await
            .map_err(|err| match err {
                TemplateError::Redis(redis) => ThinTemplateError::Redis(redis),
                TemplateError::Unavailable => ThinTemplateError::Unavailable,
                TemplateError::Corrupted => {
                    error!("Got corrupted template error on `extra_to_variables`, by using `default_extra`.");
                    ThinTemplateError::Unavailable
                },
            })
    }

    async fn variables_to_extra_validated(
        &self,
        mut cache_client: ConnectionManager,
        old_extra: Value,
        variables: HashMap<String, String>,
    ) -> Result<Option<Value>, TemplateError> {
        let extra: <Self as Template>::Extra =
            serde_json::from_value(old_extra).map_err(|_err| TemplateError::Corrupted)?;
        let Some(extra) = <Self as Template>::variables_to_extra_validated(
            self,
            &load_cache_required::<TemplateError, _>(&mut cache_client, self.id()).await?,
            extra,
            variables,
        )
        .await?
        else {
            return Ok(None);
        };
        Ok(Some(
            serde_json::to_value(&extra).expect("Unable to serialize extra"),
        ))
    }

    async fn enabled_features(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<HashSet<&'static str>, TemplateError> {
        let extra: <Self as Template>::Extra =
            serde_json::from_value(extra).map_err(|_err| TemplateError::Corrupted)?;
        <Self as Template>::enabled_features(
            self,
            &load_cache_required::<TemplateError, _>(&mut cache_client, self.id()).await?,
            extra,
        )
        .await
    }

    async fn primary_port(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
        ports: &HashMap<u32, ServerPort>,
    ) -> Result<Option<(u32, ServerPort, u16)>, TemplateError> {
        let extra: <Self as Template>::Extra =
            serde_json::from_value(extra).map_err(|_err| TemplateError::Corrupted)?;
        Ok(<Self as Template>::primary_port(
            self,
            &load_cache_required::<TemplateError, _>(&mut cache_client, self.id()).await?,
            extra,
            ports,
        )
        .await)
    }

    async fn init(
        &self,
        mut cache_client: ConnectionManager,
        skip_cache_update: bool,
    ) -> Result<(), RedisError> {
        debug!("Initializing Template {}", self.id());

        <Self as Template>::init(self, cache_client.clone()).await?;
        let cache_obj = match load_cache(&mut cache_client, self.id()).await? {
            None => {
                info!("Cache for Template {} not found. Generating...", self.id());
                let cache_obj = T::update_cache().await.map_err(|()| {
                    io::Error::other(format!("Failed to update cache for template {}", self.id()))
                })?;
                save_cache(&mut cache_client, self.id(), &cache_obj).await?;
                cache_obj
            }
            Some(cache) => cache,
        };

        debug!("Template {} ready", self.id());

        let id = self.id();

        if skip_cache_update {
            info!("Skipping cache updates for Template {id}");
            return Ok(());
        }

        tokio::task::spawn(async move {
            let mut cache_obj = cache_obj;

            loop {
                if T::cache_update_needed(&cache_obj) {
                    debug!("Updating Cache for {}", id);
                    match T::update_cache().await {
                        Ok(obj) => {
                            if let Err(err) = save_cache(&mut cache_client, id, &obj).await {
                                error!(
                                    "Failed to update cache for template {}: {:?} (save_cache)",
                                    id, err
                                );
                            } else {
                                cache_obj = obj;
                            }
                        }
                        Err(()) => {
                            error!("Failed to update cache for template {id} (update_cache)");
                        }
                    }
                }
                tokio::time::sleep(Duration::from_mins(10)).await;
            }
        });
        Ok(())
    }

    async fn refresh_cache(&self, mut cache_client: ConnectionManager) -> Result<(), io::Error> {
        info!("Refreshing cache for Template {}", self.id());
        let cache_obj = T::update_cache().await.map_err(|()| {
            io::Error::other(format!("Failed to update cache for template {}", self.id()))
        })?;
        save_cache(&mut cache_client, self.id(), &cache_obj).await
    }

    fn default_internet_access(&self) -> bool {
        <Self as Template>::default_internet_access(self)
    }

    fn supports_custom_environment(&self) -> bool {
        <Self as Template>::supports_custom_environment(self)
    }

    fn licenses(&self) -> &'static [&'static License] {
        <Self as Template>::licenses(self)
    }
}
