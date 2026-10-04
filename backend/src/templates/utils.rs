use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use bytes::Bytes;
use either::Either;
use lazy_regex::lazy_regex;
use regex::Regex;
use reqwest::Response;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use tracing::error;

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

const USER_AGENT: &str = "novium-backend";
const MAX_RELEASES: usize = 20;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub(crate) static VERSION_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"^[0-9A-Za-z][0-9A-Za-z._-]*$");

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}

pub(crate) fn template_client() -> Result<reqwest::Client, ()> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .inspect_err(|err| error!("Unable to build template cache update client: {err:?}"))
        .map_err(|_err| ())
}

pub(crate) async fn github_release_tags(
    client: &reqwest::Client,
    repository: &str,
    include_prereleases: bool,
) -> Result<Vec<String>, ()> {
    let url = format!("https://api.github.com/repos/{repository}/releases");
    let releases: Vec<GithubRelease> = client
        .get(&url)
        .query(&[("per_page", "50")])
        .send()
        .await
        .inspect_err(|err| error!("Unable to send github releases request ({url}): {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get github releases ({url}): {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive github releases ({url}): {err:?}"))
        .map_err(|_err| ())?;

    let versions: Vec<String> = releases
        .into_iter()
        .filter(|release| {
            !release.draft
                && (include_prereleases || !release.prerelease)
                && VERSION_REGEX.is_match(&release.tag_name)
        })
        .map(|release| release.tag_name)
        .take(MAX_RELEASES)
        .collect();

    if versions.is_empty() {
        error!("No releases found ({url})");
        return Err(());
    }

    Ok(versions)
}
