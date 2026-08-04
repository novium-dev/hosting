use bytes::Bytes;
use either::Either;
use reqwest::Response;
use serde::de::DeserializeOwned;

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
