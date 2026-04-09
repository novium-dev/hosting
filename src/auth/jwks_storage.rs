use jwks::Jwks;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::error;

use crate::service::error_auth_unreachable::FromAuthUnreachable;

pub struct JwksStorage {
    jwks: Mutex<Option<Arc<Jwks>>>,
    jwks_url: Box<str>,
}

impl JwksStorage {
    pub fn new(jwks_url: &str) -> Self {
        Self {
            jwks: Mutex::new(None),
            jwks_url: jwks_url.to_owned().into_boxed_str(),
        }
    }

    pub async fn fetch<E: FromAuthUnreachable>(&self) -> Result<Arc<Jwks>, E> {
        {
            let guard = self.jwks.lock().await;
            if let Some(cached) = guard.as_ref() {
                return Ok(Arc::clone(cached));
            }
        }

        let keyset = self.fetch_from_remote().await?;
        let mut guard = self.jwks.lock().await;
        *guard = Some(Arc::clone(&keyset));
        drop(guard);
        Ok(keyset)
    }

    pub async fn refresh<E: FromAuthUnreachable>(&self) -> Result<Arc<Jwks>, E> {
        let keyset = self.fetch_from_remote().await?;
        let mut guard = self.jwks.lock().await;
        *guard = Some(Arc::clone(&keyset));
        drop(guard);
        Ok(keyset)
    }

    async fn fetch_from_remote<E: FromAuthUnreachable>(&self) -> Result<Arc<Jwks>, E> {
        let keyset = Jwks::from_jwks_url(self.jwks_url.to_string())
            .await
            .inspect_err(|err| error!("unable to fetch jwks info: {err:?}"))
            .map_err(|_err| E::from())?;
        Ok(Arc::new(keyset))
    }
}
