use jwks::Jwks;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;

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

    pub async fn fetch(&self) -> Result<Arc<Jwks>, JwksFetchError> {
        let mut guard = self.jwks.lock().await;

        if let Some(cached) = guard.as_ref() {
            return Ok(Arc::clone(cached));
        }

        let keyset = self.fetch_from_remote().await?;
        *guard = Some(Arc::clone(&keyset));
        Ok(keyset)
    }

    pub async fn refresh(&self) -> Result<Arc<Jwks>, JwksFetchError> {
        let mut guard = self.jwks.lock().await;
        let keyset = self.fetch_from_remote().await?;
        *guard = Some(Arc::clone(&keyset));
        Ok(keyset)
    }

    async fn fetch_from_remote(&self) -> Result<Arc<Jwks>, JwksFetchError> {
        let keyset = Jwks::from_jwks_url(self.jwks_url.to_string())
            .await
            .map_err(|_err| JwksFetchError::Unavailable)?;
        Ok(Arc::new(keyset))
    }
}

#[derive(Debug, Error)]
pub enum JwksFetchError {
    #[error("unable to fetch jwks")]
    Unavailable,
}
