use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::{ResourceError, sanitize_file_name};

pub(crate) const OVERRIDES_DIR: &str = "overrides";
pub(crate) const SERVER_OVERRIDES_DIR: &str = "server-overrides";

pub(crate) const MODRINTH_INDEX: &str = "modrinth.index.json";
pub(crate) const CURSEFORGE_MANIFEST: &str = "manifest.json";

const MODRINTH_DOWNLOAD_HOSTS: [&str; 4] = [
    "cdn.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "gitlab.com",
];

const MAX_PLATFORM_VERSION: usize = 64;

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PackLoader {
    Fabric,
    Quilt,
    Neoforge,
    Forge,
}

impl PackLoader {
    pub(crate) fn parse_str(value: &str) -> Option<Self> {
        match value {
            "fabric" => Some(Self::Fabric),
            "quilt" => Some(Self::Quilt),
            "neoforge" => Some(Self::Neoforge),
            "forge" => Some(Self::Forge),
            _ => None,
        }
    }

    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Fabric => "Fabric",
            Self::Quilt => "Quilt",
            Self::Neoforge => "NeoForge",
            Self::Forge => "Forge",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct PackPlatform {
    pub(crate) game_version: Option<String>,
    pub(crate) loader: Option<PackLoader>,
    pub(crate) loader_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PackSource {
    Url(Url),
    Curseforge { project: String, file: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ModpackFile {
    pub(crate) path: String,
    pub(crate) source: PackSource,
    pub(crate) size: Option<u64>,
    pub(crate) sha1: Option<String>,
    pub(crate) sha512: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Modpack {
    pub(crate) name: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) platform: PackPlatform,
    pub(crate) files: Vec<ModpackFile>,
    pub(crate) rejected: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModrinthIndex {
    name: Option<String>,
    version_id: Option<String>,
    #[serde(default)]
    files: Vec<ModrinthFile>,
    #[serde(default)]
    dependencies: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModrinthFile {
    path: String,
    #[serde(default)]
    downloads: Vec<String>,
    #[serde(default)]
    hashes: HashMap<String, String>,
    file_size: Option<u64>,
    env: Option<ModrinthEnv>,
}

#[derive(Debug, Deserialize)]
struct ModrinthEnv {
    server: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeManifest {
    name: Option<String>,
    version: Option<String>,
    minecraft: Option<CurseforgeMinecraft>,
    #[serde(default)]
    files: Vec<CurseforgeFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeMinecraft {
    version: Option<String>,
    #[serde(default)]
    mod_loaders: Vec<CurseforgeLoader>,
}

#[derive(Debug, Deserialize)]
struct CurseforgeLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeFile {
    #[serde(rename = "projectID")]
    project_id: i64,
    #[serde(rename = "fileID")]
    file_id: i64,
    #[serde(default = "default_required")]
    required: bool,
}

const fn default_required() -> bool {
    true
}

pub(crate) fn safe_pack_path(path: &str) -> Option<String> {
    if path.is_empty() || path.starts_with('/') || path.starts_with('\\') {
        return None;
    }

    let mut segments = Vec::new();
    for segment in path.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." {
            return None;
        }
        let cleaned = sanitize_file_name(segment, "");
        if cleaned.is_empty() {
            return None;
        }
        segments.push(cleaned);
    }

    if segments.is_empty() {
        return None;
    }
    Some(segments.join("/"))
}

fn short_version(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()
        && value.len() <= MAX_PLATFORM_VERSION
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '+' | '_')))
    .then(|| value.to_owned())
}

pub(crate) fn allowed_download(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url
            .host_str()
            .is_some_and(|host| MODRINTH_DOWNLOAD_HOSTS.contains(&host)))
    .then_some(url)
}

fn wanted_on_server(env: Option<&ModrinthEnv>) -> bool {
    env.and_then(|env| env.server.as_deref())
        .is_none_or(|server| server != "unsupported")
}

fn modrinth_platform(dependencies: &HashMap<String, String>) -> PackPlatform {
    let loader = [
        ("fabric-loader", PackLoader::Fabric),
        ("quilt-loader", PackLoader::Quilt),
        ("neoforge", PackLoader::Neoforge),
        ("forge", PackLoader::Forge),
    ]
    .into_iter()
    .find_map(|(key, loader)| {
        dependencies
            .get(key)
            .map(|version| (loader, short_version(version)))
    });

    let (loader, loader_version) =
        loader.map_or((None, None), |(loader, version)| (Some(loader), version));

    PackPlatform {
        game_version: dependencies
            .get("minecraft")
            .and_then(|version| short_version(version)),
        loader,
        loader_version,
    }
}

fn hex_hash(hashes: &HashMap<String, String>, kind: &str, len: usize) -> Option<String> {
    hashes
        .get(kind)
        .filter(|hash| hash.len() == len && hash.chars().all(|ch| ch.is_ascii_hexdigit()))
        .map(|hash| hash.to_lowercase())
}

pub(crate) fn parse_modrinth_index(raw: &[u8]) -> Result<Modpack, ResourceError> {
    let index: ModrinthIndex =
        serde_json::from_slice(raw).map_err(|_err| ResourceError::ProviderError)?;

    let mut files = Vec::new();
    let mut rejected = Vec::new();
    for file in index.files {
        if !wanted_on_server(file.env.as_ref()) {
            continue;
        }
        let Some(path) = safe_pack_path(&file.path) else {
            rejected.push(file.path);
            continue;
        };
        let Some(url) = file
            .downloads
            .iter()
            .find_map(|download| allowed_download(download))
        else {
            rejected.push(path);
            continue;
        };

        files.push(ModpackFile {
            path,
            source: PackSource::Url(url),
            size: file.file_size,
            sha1: hex_hash(&file.hashes, "sha1", 40),
            sha512: hex_hash(&file.hashes, "sha512", 128),
        });
    }

    Ok(Modpack {
        name: index.name,
        version: index.version_id,
        platform: modrinth_platform(&index.dependencies),
        files,
        rejected,
    })
}

fn curseforge_platform(minecraft: Option<CurseforgeMinecraft>) -> PackPlatform {
    let Some(minecraft) = minecraft else {
        return PackPlatform::default();
    };

    let primary = minecraft
        .mod_loaders
        .iter()
        .find(|loader| loader.primary)
        .or_else(|| minecraft.mod_loaders.first());
    let loader = primary.and_then(|loader| {
        let (name, version) = loader.id.split_once('-')?;
        Some((PackLoader::parse_str(name)?, short_version(version)))
    });

    PackPlatform {
        game_version: minecraft.version.as_deref().and_then(short_version),
        loader: loader.as_ref().map(|(loader, _)| *loader),
        loader_version: loader.and_then(|(_, version)| version),
    }
}

pub(crate) fn parse_curseforge_manifest(raw: &[u8]) -> Result<Modpack, ResourceError> {
    let manifest: CurseforgeManifest =
        serde_json::from_slice(raw).map_err(|_err| ResourceError::ProviderError)?;

    let files = manifest
        .files
        .into_iter()
        .filter(|file| file.required)
        .map(|file| ModpackFile {
            path: String::new(),
            source: PackSource::Curseforge {
                project: file.project_id.to_string(),
                file: file.file_id.to_string(),
            },
            size: None,
            sha1: None,
            sha512: None,
        })
        .collect();

    Ok(Modpack {
        name: manifest.name,
        version: manifest.version,
        platform: curseforge_platform(manifest.minecraft),
        files,
        rejected: Vec::new(),
    })
}
