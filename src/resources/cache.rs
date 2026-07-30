use core::future::Future;
use redis::AsyncCommands as _;
use redis::aio::ConnectionManager;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tracing::warn;

use super::ResourceError;

/// Reads `key` from Valkey, falling back to `fetch` on a miss and storing the
/// normalized result for `ttl` seconds.
///
/// Cache faults are logged and treated as a miss: a degraded cache should make
/// the resource browser slower, not broken. Only the normalized shape is
/// stored, so a provider changing its payload never poisons a live cache.
pub(crate) async fn cached<T, F>(
    cache: &mut ConnectionManager,
    key: &str,
    ttl: u64,
    fetch: F,
) -> Result<T, ResourceError>
where
    T: Serialize + DeserializeOwned,
    F: Future<Output = Result<T, ResourceError>>,
{
    let key = format!("{}resource:{key}", crate::CACHE_KEY_PREFIX);

    match cache.get::<_, Option<Vec<u8>>>(&key).await {
        Ok(Some(raw)) => match serde_json::from_slice(&raw) {
            Ok(value) => return Ok(value),
            Err(err) => warn!("Discarding unreadable resource cache entry {key}: {err:?}"),
        },
        Ok(None) => {}
        Err(err) => warn!("Failed to read resource cache entry {key}: {err:?}"),
    }

    let value = fetch.await?;

    match serde_json::to_vec(&value) {
        Ok(raw) => {
            if let Err(err) = cache.set_ex::<_, _, ()>(&key, raw, ttl).await {
                warn!("Failed to store resource cache entry {key}: {err:?}");
            }
        }
        Err(err) => warn!("Failed to serialize resource cache entry {key}: {err:?}"),
    }

    Ok(value)
}
