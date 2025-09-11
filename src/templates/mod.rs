pub mod variable;
use crate::__deprecated_error::HttpError;
use crate::db::server::ports::{NetworkProtocol, ServerPort};
use async_trait::async_trait;
use bytes::Bytes;
use core::future::Future;
use core::time::Duration;
pub use daemon_common::service::server::ServerBuildPayload;
use either::Either;
use redis::AsyncCommands as _;
pub use redis::aio::ConnectionManager;
use reqwest::Response;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use speedy::{LittleEndian, Readable, Writable};
use std::collections::{HashMap, HashSet};
use std::io;
use tracing::{debug, error, info};
use variable::VariablePayload;

#[derive(Debug, Serialize)]
pub struct TemplatePortDefinition {
    pub protocol: NetworkProtocol,
    pub internal_port: u16,
    pub placeholder: String,
}

pub trait Template {
    const ID: &'static str;
    type Extra: Serialize + for<'a> Deserialize<'a> + Send + Sync;
    type Cache: for<'a> Readable<'a, LittleEndian> + Writable<LittleEndian> + Send + Sync + 'static;

    fn extra_to_build_payload(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> impl Future<Output = Result<ServerBuildPayload, HttpError>> + Send + Sync;

    fn default_extra(
        &self,
        cache: &Self::Cache,
    ) -> impl Future<Output = Result<Self::Extra, HttpError>> + Send + Sync;

    fn default_ports(
        &self,
    ) -> impl Future<Output = Result<HashMap<String, TemplatePortDefinition>, HttpError>> + Send + Sync;

    fn extra_to_variables(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> impl Future<Output = Result<VariablePayload, HttpError>> + Send + Sync;

    fn variables_to_extra_validated(
        &self,
        cache: &Self::Cache,
        old_extra: Self::Extra,
        variables: HashMap<String, String>,
    ) -> impl Future<Output = Result<Self::Extra, HttpError>> + Send + Sync;

    fn enabled_features(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> impl Future<Output = Result<HashSet<&'static str>, HttpError>> + Send + Sync;

    fn default_internet_access(&self) -> bool;

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

    fn init(
        &self,
        cache_client: ConnectionManager,
    ) -> impl Future<Output = Result<(), io::Error>> + Send + Sync;

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
    ) -> Result<ServerBuildPayload, HttpError>;

    async fn default_ports(&self) -> Result<HashMap<String, TemplatePortDefinition>, HttpError>;

    async fn default_extra(&self, cache_client: ConnectionManager) -> Result<Value, HttpError>;

    async fn extra_to_variables(
        &self,
        cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<VariablePayload, HttpError>;

    async fn variables_to_extra_validated(
        &self,
        cache_client: ConnectionManager,
        old_extra: Value,
        variables: HashMap<String, String>,
    ) -> Result<Value, HttpError>;

    async fn enabled_features(
        &self,
        cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<HashSet<&'static str>, HttpError>;

    async fn primary_port(
        &self,
        cache_client: ConnectionManager,
        extra: Value,
        ports: &HashMap<u32, ServerPort>,
    ) -> Result<Option<(u32, ServerPort, u16)>, HttpError>;

    async fn init(&self, cache_client: ConnectionManager) -> Result<(), io::Error>;

    fn default_internet_access(&self) -> bool;
}

async fn load_cache<'a, T: Readable<'a, LittleEndian> + Send + Sync>(
    cache: &mut ConnectionManager,
    id: &'static str,
) -> Result<Option<T>, HttpError> {
    let key = format!("{}template:{}", crate::CACHE_KEY_PREFIX, id);
    if !cache
        .exists::<_, bool>(&key)
        .await
        .map_err(|_err| crate::__deprecated_error::cache::CACHE_DATA_ERROR)?
    {
        return Ok(None);
    }
    let value: Vec<u8> = cache
        .get(&key)
        .await
        .map_err(|_err| crate::__deprecated_error::cache::CACHE_DATA_ERROR)?;
    T::read_from_buffer_copying_data(&value)
        .map_err(|_err| crate::__deprecated_error::cache::CACHE_DATA_ERROR)
        .map(|val| Some(val))
}

async fn load_cache_required<'a, T: Readable<'a, LittleEndian> + Send + Sync>(
    cache: &mut ConnectionManager,
    id: &'static str,
) -> Result<T, HttpError> {
    load_cache(cache, id)
        .await?
        .map_or_else(|| Err(crate::__deprecated_error::cache::CACHE_MISSING), Ok)
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

#[async_trait]
impl<T: Template + Send + Sync> TemplateInner for T {
    fn id(&self) -> &'static str {
        <Self as Template>::ID
    }

    async fn extra_to_build_payload(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<ServerBuildPayload, HttpError> {
        let extra: <Self as Template>::Extra = serde_json::from_value(extra)
            .map_err(|_err| crate::__deprecated_error::server::DAEMON_CONFIG_INVALID)?;
        self.extra_to_build_payload(
            &load_cache_required(&mut cache_client, self.id()).await?,
            extra,
        )
        .await
    }

    async fn default_ports(&self) -> Result<HashMap<String, TemplatePortDefinition>, HttpError> {
        <Self as Template>::default_ports(self).await
    }

    async fn default_extra(&self, mut cache_client: ConnectionManager) -> Result<Value, HttpError> {
        Ok(serde_json::to_value(
            &<Self as Template>::default_extra(
                self,
                &load_cache_required(&mut cache_client, self.id()).await?,
            )
            .await?,
        )
        .expect("Unable to serialize default extra"))
    }

    async fn extra_to_variables(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<VariablePayload, HttpError> {
        let extra: <Self as Template>::Extra = serde_json::from_value(extra)
            .map_err(|_err| crate::__deprecated_error::server::DAEMON_CONFIG_INVALID)?;
        <Self as Template>::extra_to_variables(
            self,
            &load_cache_required(&mut cache_client, self.id()).await?,
            extra,
        )
        .await
    }

    async fn variables_to_extra_validated(
        &self,
        mut cache_client: ConnectionManager,
        old_extra: Value,
        variables: HashMap<String, String>,
    ) -> Result<Value, HttpError> {
        let extra: <Self as Template>::Extra = serde_json::from_value(old_extra)
            .map_err(|_err| crate::__deprecated_error::server::DAEMON_CONFIG_INVALID)?;
        Ok(serde_json::to_value(
            &<Self as Template>::variables_to_extra_validated(
                self,
                &load_cache_required(&mut cache_client, self.id()).await?,
                extra,
                variables,
            )
            .await?,
        )
        .expect("Unable to serialize extra"))
    }

    async fn enabled_features(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
    ) -> Result<HashSet<&'static str>, HttpError> {
        let extra: <Self as Template>::Extra = serde_json::from_value(extra)
            .map_err(|_err| crate::__deprecated_error::server::DAEMON_CONFIG_INVALID)?;
        <Self as Template>::enabled_features(
            self,
            &load_cache_required(&mut cache_client, self.id()).await?,
            extra,
        )
        .await
    }

    async fn primary_port(
        &self,
        mut cache_client: ConnectionManager,
        extra: Value,
        ports: &HashMap<u32, ServerPort>,
    ) -> Result<Option<(u32, ServerPort, u16)>, HttpError> {
        let extra: <Self as Template>::Extra = serde_json::from_value(extra)
            .map_err(|_err| crate::__deprecated_error::server::DAEMON_CONFIG_INVALID)?;
        Ok(<Self as Template>::primary_port(
            self,
            &load_cache_required(&mut cache_client, self.id()).await?,
            extra,
            ports,
        )
        .await)
    }

    async fn init(&self, mut cache_client: ConnectionManager) -> Result<(), io::Error> {
        debug!("Initializing Template {}", self.id());

        <Self as Template>::init(self, cache_client.clone()).await?;
        let cache_obj = match load_cache(&mut cache_client, self.id())
            .await
            .map_err(|err| io::Error::other(err.1))?
        {
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
        tokio::task::spawn(async move {
            let mut cache_obj = cache_obj;

            #[expect(clippy::infinite_loop, reason = "intended behaviour")]
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
                tokio::time::sleep(Duration::from_secs(60 * 10)).await;
            }
        });
        Ok(())
    }

    fn default_internet_access(&self) -> bool {
        <Self as Template>::default_internet_access(self)
    }
}

pub trait ReqwestJsonExtension {
    fn json_verbose<T: DeserializeOwned>(
        self,
    ) -> impl Future<Output = Result<T, Either<(Bytes, serde_json::Error), reqwest::Error>>> + Send;
}

impl ReqwestJsonExtension for Response {
    async fn json_verbose<T: DeserializeOwned>(
        self,
    ) -> Result<T, Either<(Bytes, serde_json::Error), reqwest::Error>> {
        let full = self.bytes().await.map_err(Either::Right)?;

        serde_json::from_slice(&full).map_err(|err| Either::Left((full, err)))
    }
}
