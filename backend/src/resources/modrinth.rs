use reqwest::Client;
use serde::Deserialize;

use super::{
    ResolvedResource, ResourceError, ResourceKind, ResourceLoader, ResourceProject,
    ResourceProvider, ResourceQuery, ResourceVersion, ResourceVersionType, encode_segment,
    fetch_json, sanitize_file_name,
};

const API: &str = "https://api.modrinth.com/v2";

const PROVIDER: ResourceProvider = ResourceProvider::Modrinth;

const SITE: &str = "https://modrinth.com";

#[derive(Debug, Deserialize)]
struct SearchResponse {
    hits: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    project_id: String,
    slug: String,
    title: String,
    author: String,
    description: String,
    icon_url: Option<String>,
    downloads: u64,
    follows: u64,
    #[serde(default)]
    display_categories: Vec<String>,
    #[serde(default)]
    categories: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[expect(
    clippy::struct_field_names,
    reason = "mirrors the provider payload field for field"
)]
struct Version {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    version_type: String,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    downloads: u64,
    date_published: Option<String>,
    #[serde(default)]
    files: Vec<VersionFile>,
}

#[derive(Debug, Deserialize, Clone)]
struct VersionFile {
    url: String,
    filename: String,
    primary: bool,
}

impl Version {
    fn primary_file(&self) -> Option<&VersionFile> {
        self.files
            .iter()
            .find(|file| file.primary)
            .or_else(|| self.files.first())
    }
}

fn version_type(raw: &str) -> ResourceVersionType {
    match raw {
        "alpha" => ResourceVersionType::Alpha,
        "beta" => ResourceVersionType::Beta,
        _ => ResourceVersionType::Release,
    }
}

fn to_project(hit: SearchHit, project_type: &str) -> ResourceProject {
    let categories = if hit.display_categories.is_empty() {
        hit.categories
    } else {
        hit.display_categories
    };
    let page_url = format!("{SITE}/{project_type}/{}", hit.slug);

    ResourceProject {
        provider: PROVIDER,
        id: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        author: Some(hit.author),
        description: hit.description,
        icon_url: hit.icon_url.filter(|url| !url.is_empty()),
        downloads: hit.downloads,
        follows: hit.follows,
        categories,
        page_url: Some(page_url),
        downloadable: true,
    }
}

fn to_version(version: Version) -> ResourceVersion {
    let file = version.primary_file().cloned();

    ResourceVersion {
        provider: PROVIDER,
        id: version.id,
        project: version.project_id,
        name: version.name,
        version_number: version.version_number,
        version_type: version_type(&version.version_type),
        game_versions: version.game_versions,
        loaders: version.loaders,
        downloads: version.downloads,
        published_at: version.date_published,
        file_name: file.as_ref().map(|file| file.filename.clone()),
        downloadable: file.is_some(),
    }
}

pub(super) async fn search(
    client: &Client,
    query: &ResourceQuery,
) -> Result<Vec<ResourceProject>, ResourceError> {
    let project_type = match (query.kind, query.loader) {
        (ResourceKind::Modpack, _) => "modpack",
        (ResourceKind::Resource, ResourceLoader::Paper) => "plugin",
        (
            ResourceKind::Resource,
            ResourceLoader::Fabric | ResourceLoader::Forge | ResourceLoader::Neoforge,
        ) => "mod",
    };

    let mut facets = vec![
        vec![format!("project_type:{project_type}")],
        vec![format!("categories:{}", query.loader.as_str())],
        vec![
            "server_side:required".to_owned(),
            "server_side:optional".to_owned(),
        ],
    ];
    if let Some(game_version) = query.game_version.as_deref() {
        facets.push(vec![format!("versions:{game_version}")]);
    }

    let facets = serde_json::to_string(&facets).map_err(|_err| ResourceError::ProviderError)?;
    let limit = query.limit.to_string();
    let offset = query.offset.to_string();
    let index = if query.query.trim().is_empty() {
        "downloads"
    } else {
        "relevance"
    };

    let response: SearchResponse = fetch_json(
        PROVIDER,
        client.get(format!("{API}/search")).query(&[
            ("query", query.query.as_str()),
            ("limit", limit.as_str()),
            ("offset", offset.as_str()),
            ("index", index),
            ("facets", facets.as_str()),
        ]),
    )
    .await?;

    Ok(response
        .hits
        .into_iter()
        .map(|hit| to_project(hit, project_type))
        .collect())
}

pub(super) async fn versions(
    client: &Client,
    project: &str,
    loader: ResourceLoader,
    game_version: Option<&str>,
) -> Result<Vec<ResourceVersion>, ResourceError> {
    let loaders =
        serde_json::to_string(&[loader.as_str()]).map_err(|_err| ResourceError::ProviderError)?;
    let mut params = vec![("loaders", loaders)];
    if let Some(game_version) = game_version {
        params.push((
            "game_versions",
            serde_json::to_string(&[game_version]).map_err(|_err| ResourceError::ProviderError)?,
        ));
    }

    let versions: Vec<Version> = fetch_json(
        PROVIDER,
        client
            .get(format!("{API}/project/{}/version", encode_segment(project)))
            .query(&params),
    )
    .await?;

    Ok(versions.into_iter().map(to_version).collect())
}

pub(super) async fn resolve(
    client: &Client,
    version: &str,
) -> Result<ResolvedResource, ResourceError> {
    let version: Version = fetch_json(
        PROVIDER,
        client.get(format!("{API}/version/{}", encode_segment(version))),
    )
    .await?;

    let file = version
        .primary_file()
        .cloned()
        .ok_or(ResourceError::DownloadUnavailable)?;

    Ok(ResolvedResource {
        url: file
            .url
            .parse()
            .map_err(|_err| ResourceError::ProviderError)?,
        file_name: sanitize_file_name(&file.filename, "modrinth-resource.jar"),
    })
}
