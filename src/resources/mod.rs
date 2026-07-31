mod cache;
mod curseforge;
mod hangar;
pub(crate) mod modpack;
mod modrinth;
mod spigot;

use core::fmt::Write as _;
use redis::RedisError;
use redis::aio::ConnectionManager;
use reqwest::{Client, RequestBuilder, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tracing::{debug, error};

use crate::service::{
    error_resource_download_unavailable::FromResourceDownloadUnavailable,
    error_resource_invalid_payload::FromResourceInvalidPayload,
    error_resource_missing::FromResourceMissing,
    error_resource_provider_disabled::FromResourceProviderDisabled,
    error_resource_provider_error::FromResourceProviderError,
    error_resource_provider_unavailable::FromResourceProviderUnavailable,
};

const SEARCH_TTL: u64 = 300;
const VERSIONS_TTL: u64 = 300;
const RESOLVE_TTL: u64 = 900;

pub(crate) const MAX_SEARCH_LIMIT: u8 = 50;
pub(crate) const MAX_QUERY_LENGTH: usize = 120;

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResourceProvider {
    Modrinth,
    Curseforge,
    Hangar,
    Spigot,
}

impl ResourceProvider {
    pub(crate) const ALL: [Self; 4] =
        [Self::Modrinth, Self::Curseforge, Self::Hangar, Self::Spigot];

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Modrinth => "modrinth",
            Self::Curseforge => "curseforge",
            Self::Hangar => "hangar",
            Self::Spigot => "spigot",
        }
    }

    pub(crate) fn parse_str(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.as_str() == value)
    }

    pub(crate) const fn supports(self, loader: ResourceLoader, kind: ResourceKind) -> bool {
        match kind {
            ResourceKind::Resource => match self {
                Self::Modrinth | Self::Curseforge => true,
                Self::Hangar | Self::Spigot => matches!(loader, ResourceLoader::Paper),
            },
            ResourceKind::Modpack => {
                matches!(self, Self::Modrinth | Self::Curseforge)
                    && !matches!(loader, ResourceLoader::Paper)
            }
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResourceKind {
    Resource,
    Modpack,
}

impl ResourceKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Resource => "resource",
            Self::Modpack => "modpack",
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResourceLoader {
    Paper,
    Fabric,
    Forge,
    Neoforge,
}

impl ResourceLoader {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Paper => "paper",
            Self::Fabric => "fabric",
            Self::Forge => "forge",
            Self::Neoforge => "neoforge",
        }
    }

    pub(crate) const fn resource_type(self) -> ResourceType {
        match self {
            Self::Paper => ResourceType::Plugin,
            Self::Fabric | Self::Forge | Self::Neoforge => ResourceType::Modification,
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) enum ResourceType {
    #[serde(rename = "plugin")]
    Plugin,
    #[serde(rename = "modification")]
    Modification,
    #[serde(rename = "data_pack")]
    DataPack,
}

impl ResourceType {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Plugin => "plugin",
            Self::Modification => "modification",
            Self::DataPack => "data_pack",
        }
    }

    pub(crate) fn parse_str(value: &str) -> Option<Self> {
        match value {
            "plugin" => Some(Self::Plugin),
            "modification" => Some(Self::Modification),
            "data_pack" => Some(Self::DataPack),
            _ => None,
        }
    }

    pub(crate) const fn path_prefix(self) -> &'static str {
        match self {
            Self::Plugin => "plugins/",
            Self::Modification => "mods/",
            Self::DataPack => "world/datapacks/",
        }
    }

    pub(crate) fn directory(self) -> String {
        format!("/{}", self.path_prefix().trim_end_matches('/'))
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResourceVersionType {
    Release,
    Beta,
    Alpha,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct ResourceProject {
    pub(crate) provider: ResourceProvider,
    pub(crate) id: String,
    pub(crate) slug: String,
    pub(crate) title: String,
    pub(crate) author: Option<String>,
    pub(crate) description: String,
    pub(crate) icon_url: Option<String>,
    pub(crate) downloads: u64,
    pub(crate) follows: u64,
    pub(crate) categories: Vec<String>,
    pub(crate) page_url: Option<String>,
    pub(crate) downloadable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct ResourceVersion {
    pub(crate) provider: ResourceProvider,
    pub(crate) id: String,
    pub(crate) project: String,
    pub(crate) name: String,
    pub(crate) version_number: String,
    pub(crate) version_type: ResourceVersionType,
    pub(crate) game_versions: Vec<String>,
    pub(crate) loaders: Vec<String>,
    pub(crate) downloads: u64,
    pub(crate) published_at: Option<String>,
    pub(crate) file_name: Option<String>,
    pub(crate) downloadable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ResolvedResource {
    pub(crate) url: Url,
    pub(crate) file_name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ResourceQuery {
    pub(crate) query: String,
    pub(crate) loader: ResourceLoader,
    pub(crate) kind: ResourceKind,
    pub(crate) game_version: Option<String>,
    pub(crate) limit: u8,
    pub(crate) offset: u32,
}

impl ResourceQuery {
    fn cache_key(&self) -> String {
        format!(
            "{}:{}:{}:{}:{}:{}",
            self.kind.as_str(),
            self.loader.as_str(),
            self.game_version.as_deref().unwrap_or(""),
            self.limit,
            self.offset,
            self.query
        )
    }
}

#[derive(Debug)]
pub(crate) enum ResourceError {
    InvalidPayload,
    ProviderUnavailable,
    ProviderError,
    ProviderDisabled,
    DownloadUnavailable,
    Missing,
    Cache(RedisError),
}

impl From<RedisError> for ResourceError {
    fn from(value: RedisError) -> Self {
        Self::Cache(value)
    }
}

impl ResourceError {
    pub(crate) const fn reason(&self) -> &'static str {
        match self {
            Self::InvalidPayload => "The resource request was invalid",
            Self::ProviderUnavailable => "The provider could not be reached",
            Self::ProviderError => "The provider returned an error",
            Self::ProviderDisabled => "The provider is not configured",
            Self::DownloadUnavailable => "The file cannot be downloaded automatically",
            Self::Missing => "The version no longer exists",
            Self::Cache(_) => "The cache is unavailable",
        }
    }

    pub(crate) fn into<
        E: FromResourceInvalidPayload
            + FromResourceProviderUnavailable
            + FromResourceProviderError
            + FromResourceProviderDisabled
            + FromResourceDownloadUnavailable
            + FromResourceMissing
            + From<RedisError>,
    >(
        self,
    ) -> E {
        match self {
            Self::InvalidPayload => <E as FromResourceInvalidPayload>::from(),
            Self::ProviderUnavailable => <E as FromResourceProviderUnavailable>::from(),
            Self::ProviderError => <E as FromResourceProviderError>::from(),
            Self::ProviderDisabled => <E as FromResourceProviderDisabled>::from(),
            Self::DownloadUnavailable => <E as FromResourceDownloadUnavailable>::from(),
            Self::Missing => <E as FromResourceMissing>::from(),
            Self::Cache(redis) => <E as From<RedisError>>::from(redis),
        }
    }
}

pub(crate) async fn fetch_json<T: DeserializeOwned>(
    provider: ResourceProvider,
    request: RequestBuilder,
) -> Result<T, ResourceError> {
    let response = request
        .send()
        .await
        .inspect_err(|err| error!("Failed to contact {}: {err:?}", provider.as_str()))
        .map_err(|_err| ResourceError::ProviderUnavailable)?;

    let status = response.status();
    if !status.is_success() {
        if status == StatusCode::NOT_FOUND {
            debug!("{} reported a missing resource", provider.as_str());
            return Err(ResourceError::Missing);
        }
        let body = response.text().await.unwrap_or_default();
        error!(
            "{} returned status {status}: {}",
            provider.as_str(),
            body.chars().take(512).collect::<String>()
        );
        return Err(ResourceError::ProviderError);
    }

    response
        .json::<T>()
        .await
        .inspect_err(|err| {
            error!(
                "Failed to parse {} response body: {err:?}",
                provider.as_str()
            );
        })
        .map_err(|_err| ResourceError::ProviderError)
}

pub(crate) fn encode_segment(segment: &str) -> String {
    let mut encoded = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

pub(crate) fn validate_id(id: &str, max_len: usize) -> Result<(), ResourceError> {
    if id.is_empty()
        || id.len() > max_len
        || id.contains("..")
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+'))
    {
        return Err(ResourceError::InvalidPayload);
    }
    Ok(())
}

const MAX_FILE_NAME: usize = 200;

pub(crate) fn sanitize_file_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+' | '(' | ')') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('.').trim_matches('_');

    if trimmed.is_empty() {
        return fallback.to_owned();
    }
    if trimmed.chars().count() <= MAX_FILE_NAME {
        return trimmed.to_owned();
    }

    let extension = trimmed
        .rsplit_once('.')
        .map(|(_stem, extension)| extension)
        .filter(|extension| !extension.is_empty() && extension.chars().count() <= 16);

    extension.map_or_else(
        || trimmed.chars().take(MAX_FILE_NAME).collect(),
        |extension| {
            let keep = MAX_FILE_NAME - extension.chars().count() - 1;
            let stem: String = trimmed.chars().take(keep).collect();
            format!("{stem}.{extension}")
        },
    )
}

pub(crate) struct ResourceClient<'a> {
    pub(crate) http: &'a Client,
    pub(crate) cache: ConnectionManager,
    pub(crate) curseforge_api_key: Option<&'a str>,
}

impl ResourceClient<'_> {
    pub(crate) fn available(&self) -> Vec<ResourceProvider> {
        ResourceProvider::ALL
            .into_iter()
            .filter(|provider| self.enabled(*provider))
            .collect()
    }

    pub(crate) const fn enabled(&self, provider: ResourceProvider) -> bool {
        match provider {
            ResourceProvider::Curseforge => self.curseforge_api_key.is_some(),
            ResourceProvider::Modrinth | ResourceProvider::Hangar | ResourceProvider::Spigot => {
                true
            }
        }
    }

    const fn check(
        &self,
        provider: ResourceProvider,
        loader: ResourceLoader,
        kind: ResourceKind,
    ) -> Result<(), ResourceError> {
        if !self.enabled(provider) {
            return Err(ResourceError::ProviderDisabled);
        }
        if !provider.supports(loader, kind) {
            return Err(ResourceError::InvalidPayload);
        }
        Ok(())
    }

    pub(crate) async fn search(
        &mut self,
        provider: ResourceProvider,
        query: &ResourceQuery,
    ) -> Result<Vec<ResourceProject>, ResourceError> {
        self.check(provider, query.loader, query.kind)?;

        if query.query.len() > MAX_QUERY_LENGTH || query.limit == 0 {
            return Err(ResourceError::InvalidPayload);
        }

        let key = format!("search:{}:{}", provider.as_str(), query.cache_key());
        let (http, api_key) = (self.http, self.curseforge_api_key);
        let fetch = async move {
            match provider {
                ResourceProvider::Modrinth => modrinth::search(http, query).await,
                ResourceProvider::Curseforge => curseforge::search(http, api_key, query).await,
                ResourceProvider::Hangar => hangar::search(http, query).await,
                ResourceProvider::Spigot => spigot::search(http, query).await,
            }
        };

        cache::cached(&mut self.cache, &key, SEARCH_TTL, fetch).await
    }

    pub(crate) async fn versions(
        &mut self,
        provider: ResourceProvider,
        project: &str,
        loader: ResourceLoader,
        kind: ResourceKind,
        game_version: Option<&str>,
    ) -> Result<Vec<ResourceVersion>, ResourceError> {
        self.check(provider, loader, kind)?;
        validate_id(project, 128)?;

        let key = format!(
            "versions:{}:{project}:{}:{}",
            provider.as_str(),
            loader.as_str(),
            game_version.unwrap_or("")
        );
        let (http, api_key) = (self.http, self.curseforge_api_key);
        let fetch = async move {
            match provider {
                ResourceProvider::Modrinth => {
                    modrinth::versions(http, project, loader, game_version).await
                }
                ResourceProvider::Curseforge => {
                    curseforge::versions(http, api_key, project, loader, game_version).await
                }
                ResourceProvider::Hangar => hangar::versions(http, project, game_version).await,
                ResourceProvider::Spigot => spigot::versions(http, project).await,
            }
        };

        cache::cached(&mut self.cache, &key, VERSIONS_TTL, fetch).await
    }

    pub(crate) async fn resolve(
        &mut self,
        provider: ResourceProvider,
        project: &str,
        version: &str,
    ) -> Result<ResolvedResource, ResourceError> {
        if !self.enabled(provider) {
            return Err(ResourceError::ProviderDisabled);
        }
        validate_id(project, 128)?;
        validate_id(version, 128)?;

        let key = format!("resolve:{}:{project}:{version}", provider.as_str());
        let (http, api_key) = (self.http, self.curseforge_api_key);
        let fetch = async move {
            match provider {
                ResourceProvider::Modrinth => modrinth::resolve(http, version).await,
                ResourceProvider::Curseforge => {
                    curseforge::resolve(http, api_key, project, version).await
                }
                ResourceProvider::Hangar => hangar::resolve(http, project, version).await,
                ResourceProvider::Spigot => spigot::resolve(http, project, version),
            }
        };

        cache::cached(&mut self.cache, &key, RESOLVE_TTL, fetch).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_short_names_untouched() {
        assert_eq!(
            sanitize_file_name("Foo-1.2.jar", "fallback.jar"),
            "Foo-1.2.jar"
        );
    }

    #[test]
    fn replaces_separators_so_a_name_cannot_escape_its_directory() {
        let sanitized = sanitize_file_name("../../etc/passwd", "fallback.jar");

        assert!(!sanitized.contains('/'), "got {sanitized}");
        assert!(!sanitized.contains('\\'), "got {sanitized}");
        assert_ne!(sanitized, "..");
    }

    #[test]
    fn falls_back_when_nothing_usable_is_left() {
        assert_eq!(sanitize_file_name("...", "fallback.jar"), "fallback.jar");
    }

    #[test]
    fn truncating_a_long_name_keeps_its_extension() {
        let long = format!("{}.jar", "a".repeat(400));

        let sanitized = sanitize_file_name(&long, "fallback.jar");

        assert_eq!(
            std::path::Path::new(&sanitized)
                .extension()
                .and_then(std::ffi::OsStr::to_str),
            Some("jar"),
            "got {sanitized}"
        );
        assert_eq!(sanitized.chars().count(), MAX_FILE_NAME);
    }

    #[test]
    fn a_long_name_without_an_extension_is_just_cut() {
        let sanitized = sanitize_file_name(&"a".repeat(400), "fallback.jar");

        assert_eq!(sanitized.chars().count(), MAX_FILE_NAME);
    }
}
