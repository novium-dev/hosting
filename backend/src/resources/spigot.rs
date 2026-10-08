use chrono::DateTime;
use reqwest::Client;
use serde::Deserialize;

use super::{
    ResolvedResource, ResourceError, ResourceProject, ResourceProvider, ResourceQuery,
    ResourceVersion, ResourceVersionType, encode_segment, fetch_json, sanitize_file_name,
};

const API: &str = "https://api.spiget.org/v2";
const SPIGOT_BASE: &str = "https://www.spigotmc.org/";

const PROVIDER: ResourceProvider = ResourceProvider::Spigot;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Resource {
    id: i64,
    name: String,
    #[serde(default)]
    tag: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    tested_versions: Vec<String>,
    icon: Option<Icon>,
}

#[derive(Debug, Deserialize)]
struct Icon {
    #[serde(default)]
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    id: i64,
    name: String,
    #[serde(default)]
    downloads: u64,
    release_date: Option<i64>,
}

const INSTALLABLE: bool = false;

fn to_project(resource: Resource) -> ResourceProject {
    let page_url = format!("{SPIGOT_BASE}resources/{}/", resource.id);

    ResourceProject {
        provider: PROVIDER,
        id: resource.id.to_string(),
        slug: resource.id.to_string(),
        title: resource.name,
        author: None,
        description: resource.tag,
        icon_url: resource
            .icon
            .map(|icon| icon.url)
            .filter(|url| !url.is_empty())
            .map(|url| format!("{SPIGOT_BASE}{url}")),
        downloads: resource.downloads,
        follows: resource.likes,
        categories: resource.tested_versions,
        page_url: Some(page_url),
        downloadable: INSTALLABLE,
    }
}

fn to_version(resource: &Resource, version: &Version) -> ResourceVersion {
    ResourceVersion {
        provider: PROVIDER,
        id: version.id.to_string(),
        project: resource.id.to_string(),
        name: version.name.clone(),
        version_number: version.name.clone(),
        version_type: ResourceVersionType::Release,
        game_versions: resource.tested_versions.clone(),
        loaders: vec!["paper".to_owned()],
        downloads: version.downloads,
        published_at: version
            .release_date
            .and_then(|seconds| DateTime::from_timestamp(seconds, 0))
            .map(|date| date.to_rfc3339()),
        file_name: Some(file_name(&resource.name, &version.name)),
        downloadable: INSTALLABLE,
    }
}

fn file_name(resource: &str, version: &str) -> String {
    sanitize_file_name(&format!("{resource}-{version}.jar"), "spigot-resource.jar")
}

async fn resource(client: &Client, project: &str) -> Result<Resource, ResourceError> {
    fetch_json(
        PROVIDER,
        client.get(format!("{API}/resources/{}", encode_segment(project))),
    )
    .await
}

pub(super) async fn search(
    client: &Client,
    query: &ResourceQuery,
) -> Result<Vec<ResourceProject>, ResourceError> {
    let page = (query.offset / u32::from(query.limit.max(1))) + 1;
    let params = [
        ("size", query.limit.to_string()),
        ("page", page.to_string()),
        ("sort", "-downloads".to_owned()),
    ];

    let trimmed = query.query.trim();
    let request = if trimmed.is_empty() {
        client.get(format!("{API}/resources/free"))
    } else {
        client
            .get(format!(
                "{API}/search/resources/{}",
                encode_segment(trimmed)
            ))
            .query(&[("field", "name")])
    };

    let resources: Vec<Resource> = fetch_json(PROVIDER, request.query(&params)).await?;

    Ok(resources.into_iter().map(to_project).collect())
}

pub(super) async fn versions(
    client: &Client,
    project: &str,
) -> Result<Vec<ResourceVersion>, ResourceError> {
    let resource = resource(client, project).await?;

    let versions: Vec<Version> = fetch_json(
        PROVIDER,
        client
            .get(format!(
                "{API}/resources/{}/versions",
                encode_segment(project)
            ))
            .query(&[("size", "25"), ("page", "1"), ("sort", "-releaseDate")]),
    )
    .await?;

    Ok(versions
        .into_iter()
        .map(|version| to_version(&resource, &version))
        .collect())
}

pub(super) const fn resolve(
    _client: &Client,
    _project: &str,
    _version: &str,
) -> Result<ResolvedResource, ResourceError> {
    Err(ResourceError::DownloadUnavailable)
}
