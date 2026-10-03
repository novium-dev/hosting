use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use bytes::Bytes;
use either::Either;
use lazy_regex::lazy_regex;
use regex::Regex;
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

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub(crate) static RELATIVE_PATH_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$");

pub(crate) fn is_relative_path(value: &str) -> bool {
    RELATIVE_PATH_REGEX.is_match(value) && value.split('/').all(|part| part != "." && part != "..")
}

pub(crate) fn embed_script(path: &str, script: &str) -> String {
    format!(
        "RUN echo '{}' | base64 -d > {path} && chmod 755 {path}",
        BASE64_STANDARD.encode(script)
    )
}
