use crate::{CACHE_KEY_PREFIX, define_id};
use chrono::Duration;
use redis::aio::ConnectionManager;
use redis::{AsyncCommands, RedisError};
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
    pub(crate) async fn insert(
        &self,
        expires: Duration,
        cache: &mut ConnectionManager,
    ) -> Result<String, RedisError> {
        let flow_id = FlowId::generate();
        let key = format!("{}{}:{}", CACHE_KEY_PREFIX, FLOWS_NAMESPACE, flow_id);

        let data = Writable::write_to_vec(self)
            .inspect_err(|e| error!("Failed to serialize OAuthFlow: {:?}", e))
            .unwrap();

        let _: () = cache
            .set_ex(key, data, expires.num_seconds().unsigned_abs())
            .await
            .map_err(|e| {
                error!("Failed to insert OAuthFlow into cache: {:?}", e);
                e
            })?;

        Ok(flow_id.to_string())
    }

    pub(crate) async fn get(
        id: &str,
        cache: &mut ConnectionManager,
    ) -> Result<Option<Self>, RedisError> {
        let key = format!("{}{}:{}", CACHE_KEY_PREFIX, FLOWS_NAMESPACE, id);

        let raw: Option<Vec<u8>> = cache.get(key).await.map_err(|e| {
            error!("Failed to retrieve OAuthFlow from cache: {:?}", e);
            e
        })?;

        Ok(raw.map(|bytes| {
            Readable::read_from_buffer(&bytes)
                .inspect_err(|e| error!("Failed to deserialize OAuthFlow: {:?}", e))
                .unwrap()
        }))
    }

    pub(crate) async fn remove(id: &str, cache: &mut ConnectionManager) -> Result<(), RedisError> {
        let key = format!("{}{}:{}", CACHE_KEY_PREFIX, FLOWS_NAMESPACE, id);

        let _: () = cache.del(key).await.map_err(|e| {
            error!("Failed to remove OAuthFlow from cache: {:?}", e);
            e
        })?;

        Ok(())
    }
}
