use reqwest::{Client, RequestBuilder};
use serde::Deserialize;

use super::{
    ResolvedResource, ResourceError, ResourceKind, ResourceLoader, ResourceProject,
    ResourceProvider, ResourceQuery, ResourceVersion, ResourceVersionType, encode_segment,
    fetch_json, sanitize_file_name,
};

const API: &str = "https://api.curseforge.com/v1";

const PROVIDER: ResourceProvider = ResourceProvider::Curseforge;

const GAME_ID: &str = "432";
const CLASS_MODS: &str = "6";
const CLASS_BUKKIT_PLUGINS: &str = "5";
const CLASS_MODPACKS: &str = "4471";

const SORT_DOWNLOADS: &str = "6";
const SORT_RELEVANCY: &str = "1";

const LOADER_NAMES: [&str; 8] = [
    "Forge", "Fabric", "NeoForge", "Quilt", "Bukkit", "Spigot", "Paper", "Cauldron",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paged<T> {
    data: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Single<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mod {
    id: i64,
    name: String,
    slug: String,
    summary: String,
    download_count: f64,
    thumbs_up_count: Option<f64>,
    logo: Option<Logo>,
    links: Option<Links>,
    #[serde(default)]
    authors: Vec<Author>,
    #[serde(default)]
    categories: Vec<Category>,
    allow_mod_distribution: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct Logo {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Links {
    website_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Author {
    name: String,
}

#[derive(Debug, Deserialize)]
struct Category {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_field_names,
    reason = "mirrors the provider payload field for field"
)]
struct File {
    id: i64,
    mod_id: i64,
    display_name: String,
    file_name: String,
    release_type: u8,
    file_date: Option<String>,
    #[serde(default)]
    download_count: f64,
    #[serde(default)]
    game_versions: Vec<String>,
    download_url: Option<String>,
}

#[expect(
    clippy::cast_sign_loss,
    reason = "guarded by the positivity check above"
)]
fn count(value: f64) -> u64 {
    if value.is_finite() && value > 0.0 {
        value as u64
    } else {
        0
    }
}

const fn version_type(release_type: u8) -> ResourceVersionType {
    match release_type {
        2 => ResourceVersionType::Beta,
        3 => ResourceVersionType::Alpha,
        _ => ResourceVersionType::Release,
    }
}

const fn loader_type(loader: ResourceLoader) -> Option<&'static str> {
    match loader {
        ResourceLoader::Forge => Some("1"),
        ResourceLoader::Fabric => Some("4"),
        ResourceLoader::Neoforge => Some("6"),
        ResourceLoader::Paper | ResourceLoader::Velocity | ResourceLoader::Bungeecord => None,
    }
}

const fn class_id(loader: ResourceLoader, kind: ResourceKind) -> &'static str {
    match kind {
        ResourceKind::Modpack => CLASS_MODPACKS,
        ResourceKind::Resource => match loader {
            ResourceLoader::Paper | ResourceLoader::Velocity | ResourceLoader::Bungeecord => {
                CLASS_BUKKIT_PLUGINS
            }
            ResourceLoader::Fabric | ResourceLoader::Forge | ResourceLoader::Neoforge => CLASS_MODS,
        },
    }
}

fn authorized(
    request: RequestBuilder,
    api_key: Option<&str>,
) -> Result<RequestBuilder, ResourceError> {
    let api_key = api_key.ok_or(ResourceError::ProviderDisabled)?;
    Ok(request
        .header("x-api-key", api_key)
        .header("Accept", "application/json"))
}

fn to_project(entry: Mod) -> ResourceProject {
    ResourceProject {
        provider: PROVIDER,
        id: entry.id.to_string(),
        slug: entry.slug,
        title: entry.name,
        author: entry.authors.into_iter().next().map(|author| author.name),
        description: entry.summary,
        icon_url: entry.logo.and_then(|logo| logo.url),
        downloads: count(entry.download_count),
        follows: count(entry.thumbs_up_count.unwrap_or_default()),
        categories: entry
            .categories
            .into_iter()
            .map(|category| category.name)
            .collect(),
        page_url: entry.links.and_then(|links| links.website_url),
        downloadable: entry.allow_mod_distribution.unwrap_or(true),
    }
}

fn to_version(file: File) -> ResourceVersion {
    let (loaders, game_versions): (Vec<String>, Vec<String>) = file
        .game_versions
        .into_iter()
        .partition(|entry| LOADER_NAMES.contains(&entry.as_str()));

    ResourceVersion {
        provider: PROVIDER,
        id: file.id.to_string(),
        project: file.mod_id.to_string(),
        name: file.display_name,
        version_number: file.file_name.clone(),
        version_type: version_type(file.release_type),
        game_versions,
        loaders: loaders
            .into_iter()
            .map(|loader| loader.to_lowercase())
            .collect(),
        downloads: count(file.download_count),
        published_at: file.file_date,
        file_name: Some(file.file_name),
        downloadable: file.download_url.is_some(),
    }
}

pub(super) async fn search(
    client: &Client,
    api_key: Option<&str>,
    query: &ResourceQuery,
) -> Result<Vec<ResourceProject>, ResourceError> {
    let limit = query.limit.to_string();
    let offset = query.offset.to_string();
    let sort_field = if query.query.trim().is_empty() {
        SORT_DOWNLOADS
    } else {
        SORT_RELEVANCY
    };

    let mut params = vec![
        ("gameId", GAME_ID.to_owned()),
        ("classId", class_id(query.loader, query.kind).to_owned()),
        ("searchFilter", query.query.clone()),
        ("sortField", sort_field.to_owned()),
        ("sortOrder", "desc".to_owned()),
        ("index", offset),
        ("pageSize", limit),
    ];
    if let Some(loader_type) = loader_type(query.loader) {
        params.push(("modLoaderType", loader_type.to_owned()));
    }
    if let Some(game_version) = query.game_version.as_deref() {
        params.push(("gameVersion", game_version.to_owned()));
    }

    let response: Paged<Mod> = fetch_json(
        PROVIDER,
        authorized(client.get(format!("{API}/mods/search")), api_key)?.query(&params),
    )
    .await?;

    Ok(response.data.into_iter().map(to_project).collect())
}

pub(super) async fn versions(
    client: &Client,
    api_key: Option<&str>,
    project: &str,
    loader: ResourceLoader,
    game_version: Option<&str>,
) -> Result<Vec<ResourceVersion>, ResourceError> {
    let mut params = vec![("index", "0".to_owned()), ("pageSize", "50".to_owned())];
    if let Some(loader_type) = loader_type(loader) {
        params.push(("modLoaderType", loader_type.to_owned()));
    }
    if let Some(game_version) = game_version {
        params.push(("gameVersion", game_version.to_owned()));
    }

    let response: Paged<File> = fetch_json(
        PROVIDER,
        authorized(
            client.get(format!("{API}/mods/{}/files", encode_segment(project))),
            api_key,
        )?
        .query(&params),
    )
    .await?;

    Ok(response.data.into_iter().map(to_version).collect())
}

pub(super) async fn resolve(
    client: &Client,
    api_key: Option<&str>,
    project: &str,
    version: &str,
) -> Result<ResolvedResource, ResourceError> {
    let response: Single<File> = fetch_json(
        PROVIDER,
        authorized(
            client.get(format!(
                "{API}/mods/{}/files/{}",
                encode_segment(project),
                encode_segment(version)
            )),
            api_key,
        )?,
    )
    .await?;

    let file = response.data;
    let url = file
        .download_url
        .ok_or(ResourceError::DownloadUnavailable)?;

    Ok(ResolvedResource {
        url: url.parse().map_err(|_err| ResourceError::ProviderError)?,
        file_name: sanitize_file_name(&file.file_name, "curseforge-resource.jar"),
    })
}
