use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;

use super::{
    ResolvedResource, ResourceError, ResourceProject, ResourceProvider, ResourceQuery,
    ResourceVersion, ResourceVersionType, encode_segment, fetch_json, sanitize_file_name,
};

const API: &str = "https://hangar.papermc.io/api/v1";

const PROVIDER: ResourceProvider = ResourceProvider::Hangar;

/// Hangar is multi-platform; only the Paper artifacts are relevant here.
const PLATFORM: &str = "PAPER";

#[derive(Debug, Deserialize)]
struct Paged<T> {
    result: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    name: String,
    namespace: Namespace,
    description: String,
    category: Option<String>,
    avatar_url: Option<String>,
    stats: ProjectStats,
}

#[derive(Debug, Deserialize)]
struct Namespace {
    owner: String,
    slug: String,
}

#[derive(Debug, Deserialize)]
struct ProjectStats {
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    stars: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    name: String,
    created_at: Option<String>,
    channel: Option<Channel>,
    stats: Option<VersionStats>,
    #[serde(default)]
    downloads: HashMap<String, Download>,
    #[serde(default)]
    platform_dependencies: HashMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct Channel {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionStats {
    #[serde(default)]
    total_downloads: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_field_names,
    reason = "mirrors the provider payload field for field"
)]
struct Download {
    file_info: Option<FileInfo>,
    /// Set instead of `download_url` when the author hosts the jar elsewhere.
    external_url: Option<String>,
    download_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileInfo {
    name: String,
}

/// Hangar has no release-type field; it has user-defined channels. The stock
/// channels are Release/Snapshot/Alpha, and third-party ones are named after
/// the same idea, so match on the name and treat anything unknown as a
/// pre-release rather than claiming it is stable.
fn version_type(channel: Option<&Channel>) -> ResourceVersionType {
    let Some(channel) = channel else {
        return ResourceVersionType::Release;
    };
    let name = channel.name.to_lowercase();

    if name.contains("release") || name.contains("stable") {
        ResourceVersionType::Release
    } else if name.contains("alpha") {
        ResourceVersionType::Alpha
    } else {
        ResourceVersionType::Beta
    }
}

fn to_project(project: Project) -> ResourceProject {
    ResourceProject {
        provider: PROVIDER,
        id: project.namespace.slug.clone(),
        slug: project.namespace.slug,
        title: project.name,
        author: Some(project.namespace.owner),
        description: project.description,
        icon_url: project.avatar_url,
        downloads: project.stats.downloads,
        follows: project.stats.stars,
        categories: project.category.into_iter().collect(),
        downloadable: true,
    }
}

fn to_version(project: &str, version: Version) -> ResourceVersion {
    let download = version.downloads.get(PLATFORM);
    let file_name = download
        .and_then(|download| download.file_info.as_ref())
        .map(|info| info.name.clone());

    ResourceVersion {
        provider: PROVIDER,
        // Hangar addresses versions by name, not by numeric id, so the name is
        // what has to round-trip back to us for the download.
        id: version.name.clone(),
        project: project.to_owned(),
        name: version.name.clone(),
        version_number: version.name,
        version_type: version_type(version.channel.as_ref()),
        game_versions: version
            .platform_dependencies
            .get(PLATFORM)
            .cloned()
            .unwrap_or_default(),
        loaders: vec!["paper".to_owned()],
        downloads: version
            .stats
            .map(|stats| stats.total_downloads)
            .unwrap_or_default(),
        published_at: version.created_at,
        file_name,
        downloadable: download.is_some_and(|download| {
            download.download_url.is_some() || download.external_url.is_some()
        }),
    }
}

pub(super) async fn search(
    client: &Client,
    query: &ResourceQuery,
) -> Result<Vec<ResourceProject>, ResourceError> {
    let mut params = vec![
        ("limit", query.limit.to_string()),
        ("offset", query.offset.to_string()),
        ("sort", "-downloads".to_owned()),
        ("platform", PLATFORM.to_owned()),
    ];
    if !query.query.trim().is_empty() {
        params.push(("query", query.query.clone()));
    }
    if let Some(game_version) = query.game_version.as_deref() {
        params.push(("version", game_version.to_owned()));
    }

    let response: Paged<Project> = fetch_json(
        PROVIDER,
        client.get(format!("{API}/projects")).query(&params),
    )
    .await?;

    Ok(response.result.into_iter().map(to_project).collect())
}

pub(super) async fn versions(
    client: &Client,
    project: &str,
    game_version: Option<&str>,
) -> Result<Vec<ResourceVersion>, ResourceError> {
    let mut params = vec![
        ("limit", "25".to_owned()),
        ("offset", "0".to_owned()),
        ("platform", PLATFORM.to_owned()),
    ];
    if let Some(game_version) = game_version {
        params.push(("platformVersion", game_version.to_owned()));
    }

    let response: Paged<Version> = fetch_json(
        PROVIDER,
        client
            .get(format!(
                "{API}/projects/{}/versions",
                encode_segment(project)
            ))
            .query(&params),
    )
    .await?;

    Ok(response
        .result
        .into_iter()
        .map(|version| to_version(project, version))
        .collect())
}

pub(super) async fn resolve(
    client: &Client,
    project: &str,
    version: &str,
) -> Result<ResolvedResource, ResourceError> {
    let version: Version = fetch_json(
        PROVIDER,
        client.get(format!(
            "{API}/projects/{}/versions/{}",
            encode_segment(project),
            encode_segment(version)
        )),
    )
    .await?;

    let download = version
        .downloads
        .get(PLATFORM)
        .ok_or(ResourceError::DownloadUnavailable)?;

    // `download_url` points at Hangar's CDN for hosted jars; `external_url` is
    // the author's own host. Prefer the CDN, which is the one Hangar counts.
    let url = download
        .download_url
        .clone()
        .or_else(|| download.external_url.clone())
        .ok_or(ResourceError::DownloadUnavailable)?;

    let fallback = format!("{project}-{}.jar", version.name);
    let file_name = download
        .file_info
        .as_ref()
        .map_or_else(|| fallback.clone(), |info| info.name.clone());

    Ok(ResolvedResource {
        url: url.parse().map_err(|_err| ResourceError::ProviderError)?,
        file_name: sanitize_file_name(&file_name, &fallback),
    })
}
