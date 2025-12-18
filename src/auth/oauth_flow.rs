use crate::CACHE_KEY_PREFIX;
use chrono::Duration;
use redis::aio::ConnectionManager;
use redis::{AsyncCommands, RedisError};
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use tracing::error;

const FLOWS_NAMESPACE: &str = "oauth_flows";

#[derive(Debug, Serialize, Deserialize, Writable, Readable)]
pub(crate) struct OAuthFlow {
    /// Where to redirect the user after success
    pub(crate) redirect_url: String,

    pub(crate) state: String,
    pub(crate) verifier: String,
}

impl OAuthFlow {
    pub(crate) async fn insert(
        &self,
        expires: Duration,
        cache: &mut ConnectionManager,
    ) -> Result<(), RedisError> {
        let key = format!("{}{}:{}", CACHE_KEY_PREFIX, FLOWS_NAMESPACE, self.state);

        let data = Writable::write_to_vec(self)
            .inspect_err(|e| error!("Failed to serialize OAuthFlow: {:?}", e))
            .unwrap();

        let _: () = cache
            .set_ex(key, data, expires.num_seconds().unsigned_abs())
            .await
            .inspect_err(|e| {
                error!("Failed to insert OAuthFlow into cache: {:?}", e);
            })?;

        Ok(())
    }

    pub(crate) async fn get(
        id: &str,
        cache: &mut ConnectionManager,
    ) -> Result<Option<Self>, RedisError> {
        let key = format!("{}{}:{}", CACHE_KEY_PREFIX, FLOWS_NAMESPACE, id);

        let raw: Option<Vec<u8>> = cache.get(key).await.inspect_err(|e| {
            error!("Failed to get OAuthFlow from cache: {:?}", e);
        })?;

        Ok(raw.map(|bytes| {
            Readable::read_from_buffer(&bytes)
                .inspect_err(|e| error!("Failed to deserialize OAuthFlow: {:?}", e))
                .unwrap()
        }))
    }

    pub(crate) async fn remove(id: &str, cache: &mut ConnectionManager) -> Result<(), RedisError> {
        let key = format!("{}{}:{}", CACHE_KEY_PREFIX, FLOWS_NAMESPACE, id);

        let _: () = cache.del(key).await.inspect_err(|e| {
            error!("Failed to remove OAuthFlow from cache: {:?}", e);
        })?;

        Ok(())
    }
}
