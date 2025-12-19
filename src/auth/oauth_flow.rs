use crate::service::error_cache_failure::FromCacheFailure;
use crate::{CACHE_KEY_PREFIX, define_id};
use chrono::Duration;
use redis::aio::ConnectionManager;
use redis::{AsyncCommands as _, RedisError};
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use tracing::error;

const FLOWS_NAMESPACE: &str = "oauth_flows";

define_id!(FlowId);

#[derive(Debug, Serialize, Deserialize, Writable, Readable)]
pub(crate) struct OAuthFlow {
    /// CSRF state
    pub(crate) state: String,

    /// Where to redirect the user after success
    pub(crate) redirect_url: String,
}

impl OAuthFlow {
    pub(crate) async fn insert<E: From<RedisError> + FromCacheFailure>(
        &self,
        expires: Duration,
        cache: &mut ConnectionManager,
    ) -> Result<String, E> {
        let flow_id = FlowId::generate();
        let key = format!("{CACHE_KEY_PREFIX}{FLOWS_NAMESPACE}:{flow_id}");

        let data = Writable::write_to_vec(self)
            .inspect_err(|err| error!("Failed to serialize OAuthFlow: {err:?}"))
            .map_err(|_err| <E as FromCacheFailure>::from())?;

        let _: () = cache
            .set_ex(key, data, expires.num_seconds().unsigned_abs())
            .await
            .inspect_err(|err| error!("Failed to insert OAuthFlow into cache: {err:?}"))?;

        Ok(flow_id.to_string())
    }

    pub(crate) async fn get<E: From<RedisError> + FromCacheFailure>(
        id: &str,
        cache: &mut ConnectionManager,
    ) -> Result<Option<Self>, E> {
        let key = format!("{CACHE_KEY_PREFIX}{FLOWS_NAMESPACE}:{id}");

        let Some(bytes) = cache
            .get::<_, Option<Vec<u8>>>(key)
            .await
            .inspect_err(|err| error!("Failed to retrieve OAuthFlow from cache: {err:?}"))?
        else {
            return Ok(None);
        };

        Readable::read_from_buffer(&bytes)
            .inspect_err(|err| error!("Failed to deserialize OAuthFlow: {err:?}"))
            .map_err(|_err| <E as FromCacheFailure>::from())
    }

    pub(crate) async fn remove(id: &str, cache: &mut ConnectionManager) -> Result<(), RedisError> {
        let key = format!("{CACHE_KEY_PREFIX}{FLOWS_NAMESPACE}:{id}");

        let _: () = cache
            .del(key)
            .await
            .inspect_err(|err| error!("Failed to remove OAuthFlow from cache: {err:?}"))?;

        Ok(())
    }
}
