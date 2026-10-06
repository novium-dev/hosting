use serde::Deserialize;

use super::{ResourceError, sanitize_file_name};

pub(crate) const OVERRIDES_DIR: &str = "overrides";
pub(crate) const SERVER_OVERRIDES_DIR: &str = "server-overrides";

pub(crate) const MODRINTH_INDEX: &str = "modrinth.index.json";
pub(crate) const CURSEFORGE_MANIFEST: &str = "manifest.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ModpackFile {
    pub(crate) path: String,
    pub(crate) url: Option<String>,
    pub(crate) curseforge: Option<(String, String)>,
}

#[derive(Debug, Clone)]
pub(crate) struct Modpack {
    pub(crate) name: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) files: Vec<ModpackFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModrinthIndex {
    name: Option<String>,
    version_id: Option<String>,
    #[serde(default)]
    files: Vec<ModrinthFile>,
}

#[derive(Debug, Deserialize)]
struct ModrinthFile {
    path: String,
    #[serde(default)]
    downloads: Vec<String>,
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
    #[serde(default)]
    files: Vec<CurseforgeFile>,
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

fn wanted_on_server(env: Option<&ModrinthEnv>) -> bool {
    env.and_then(|env| env.server.as_deref())
        .is_none_or(|server| server != "unsupported")
}

pub(crate) fn parse_modrinth_index(raw: &[u8]) -> Result<Modpack, ResourceError> {
    let index: ModrinthIndex =
        serde_json::from_slice(raw).map_err(|_err| ResourceError::ProviderError)?;

    let files = index
        .files
        .into_iter()
        .filter(|file| wanted_on_server(file.env.as_ref()))
        .filter_map(|file| {
            let path = safe_pack_path(&file.path)?;
            let url = file.downloads.into_iter().next()?;
            Some(ModpackFile {
                path,
                url: Some(url),
                curseforge: None,
            })
        })
        .collect();

    Ok(Modpack {
        name: index.name,
        version: index.version_id,
        files,
    })
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
            url: None,
            curseforge: Some((file.project_id.to_string(), file.file_id.to_string())),
        })
        .collect();

    Ok(Modpack {
        name: manifest.name,
        version: manifest.version,
        files,
    })
}
