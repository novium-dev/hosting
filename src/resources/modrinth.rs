use lazy_regex::lazy_regex;
use reqwest::{Client, Url};
use serde::Deserialize;
use tracing::{debug, error};

use crate::service::{
    error_resource_invalid_payload::FromResourceInvalidPayload,
    error_resource_missing::FromResourceMissing,
    error_resource_provider_error::FromResourceProviderError,
    error_resource_provider_unavailable::FromResourceProviderUnavailable,
};

#[derive(Debug, Deserialize)]
struct VersionResponse {
    files: Vec<VersionFile>,
}

#[derive(Debug, Deserialize, Clone)]
struct VersionFile {
    url: String,
    filename: String,
    primary: bool,
}

pub(crate) async fn resolve_to_url<
    E: FromResourceInvalidPayload
        + FromResourceProviderUnavailable
        + FromResourceProviderError
        + FromResourceMissing,
>(
    client: &Client,
    version: String,
) -> Result<(Url, String), E> {
    if !lazy_regex!(r"^[A-Za-z0-9]+$").is_match(&version) {
        return Err(<E as FromResourceInvalidPayload>::from());
    }
    let response = client
        .get(format!("https://api.modrinth.com/v2/version/{version}"))
        .send()
        .await
        .inspect_err(|err| error!("Failed to contact Modrinth: {:?}", err))
        .map_err(|_err| <E as FromResourceProviderUnavailable>::from())?
        .error_for_status()
        .inspect_err(|err| debug!("Resource does not exist: {:?}", err))
        .map_err(|_err| <E as FromResourceMissing>::from())?
        .json::<VersionResponse>()
        .await
        .inspect_err(|err| error!("Failed to parse version details: {:?}", err))
        .map_err(|_err| <E as FromResourceMissing>::from())?;
    let (url, filename) = response
        .files
        .iter()
        .find(|file| file.primary)
        .map_or_else(|| response.files.first(), Some)
        .cloned()
        .map(|file| (file.url, file.filename))
        .ok_or_else(|| <E as FromResourceMissing>::from())?;
    let url = url
        .parse()
        .map_err(|_err| <E as FromResourceProviderError>::from())?;
    Ok((url, filename))
}
