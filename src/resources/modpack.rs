//! Parsing of the two modpack archive formats.
//!
//! A pack is a zip carrying a manifest plus an `overrides/` tree. The two
//! providers describe their contents very differently:
//!
//! * Modrinth's `modrinth.index.json` lists each file with a direct download URL
//!   and the path it belongs at, so no further provider calls are needed.
//! * `CurseForge`'s `manifest.json` lists project/file id pairs, which have to be
//!   resolved to URLs through the API, and gives no target path — everything
//!   goes into `mods/`.
//!
//! Everything here is pure: the orchestration that fetches and writes lives in
//! the service, so these rules can be tested without a node.

use serde::Deserialize;

use super::{ResourceError, sanitize_file_name};

/// The `overrides/` directory inside a pack, copied over the server as-is.
pub(crate) const OVERRIDES_DIR: &str = "overrides";
/// Server-specific overrides, applied after (and winning over) `overrides/`.
pub(crate) const SERVER_OVERRIDES_DIR: &str = "server-overrides";

/// Modrinth's index file name inside a `.mrpack`.
pub(crate) const MODRINTH_INDEX: &str = "modrinth.index.json";
/// `CurseForge`'s manifest file name inside a pack zip.
pub(crate) const CURSEFORGE_MANIFEST: &str = "manifest.json";

/// One file a pack wants on the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ModpackFile {
    /// Path relative to the server root, already sanitized.
    pub(crate) path: String,
    /// Where to fetch it. Empty for `CurseForge` entries until resolved.
    pub(crate) url: Option<String>,
    /// `CurseForge` project/file ids, for the entries that still need resolving.
    pub(crate) curseforge: Option<(String, String)>,
}

/// What a pack declares about itself.
#[derive(Debug, Clone)]
pub(crate) struct Modpack {
    pub(crate) name: Option<String>,
    pub(crate) version: Option<String>,
    /// The Minecraft version the pack targets, when it says.
    pub(crate) game_version: Option<String>,
    pub(crate) files: Vec<ModpackFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModrinthIndex {
    name: Option<String>,
    version_id: Option<String>,
    dependencies: Option<ModrinthDependencies>,
    #[serde(default)]
    files: Vec<ModrinthFile>,
}

#[derive(Debug, Deserialize)]
struct ModrinthDependencies {
    minecraft: Option<String>,
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
    minecraft: Option<CurseforgeMinecraft>,
    #[serde(default)]
    files: Vec<CurseforgeFile>,
}

#[derive(Debug, Deserialize)]
struct CurseforgeMinecraft {
    version: Option<String>,
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

/// Rejects a pack path that would escape the server root.
///
/// Pack manifests are third-party input, so `../` and absolute paths have to be
/// refused rather than normalized — silently relocating a file is worse than
/// skipping it. Each segment is sanitized the same way a resource file name is.
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

/// Whether a Modrinth index entry applies to a server install.
///
/// `env.server` of `unsupported` marks a client-only file — shaders, resource
/// packs, client HUD mods. Installing those onto a server wastes bandwidth and,
/// for client-only mods, stops the server booting.
fn wanted_on_server(env: Option<&ModrinthEnv>) -> bool {
    env.and_then(|env| env.server.as_deref())
        .is_none_or(|server| server != "unsupported")
}

pub(crate) fn parse_modrinth_index(raw: &[u8]) -> Result<Modpack, ResourceError> {
    let index: ModrinthIndex = serde_json::from_slice(raw).map_err(|_err| {
        // A pack whose index will not parse is not something to guess about.
        ResourceError::ProviderError
    })?;

    let files = index
        .files
        .into_iter()
        .filter(|file| wanted_on_server(file.env.as_ref()))
        .filter_map(|file| {
            let path = safe_pack_path(&file.path)?;
            // Mirrors are listed in preference order.
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
        game_version: index.dependencies.and_then(|deps| deps.minecraft),
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
            // CurseForge gives no target path; a modpack's files are all mods.
            // The real name arrives with the resolved file.
            path: String::new(),
            url: None,
            curseforge: Some((file.project_id.to_string(), file.file_id.to_string())),
        })
        .collect();

    Ok(Modpack {
        name: manifest.name,
        version: manifest.version,
        game_version: manifest.minecraft.and_then(|minecraft| minecraft.version),
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_modrinth_index() {
        let raw = br#"{
            "formatVersion": 1,
            "name": "Test Pack",
            "versionId": "1.2.3",
            "dependencies": { "minecraft": "1.21.1", "fabric-loader": "0.16.9" },
            "files": [
                { "path": "mods/alpha.jar", "downloads": ["https://cdn/alpha.jar"] },
                { "path": "config/beta.toml", "downloads": ["https://cdn/beta.toml"] }
            ]
        }"#;

        let pack = parse_modrinth_index(raw).expect("index parses");

        assert_eq!(pack.name.as_deref(), Some("Test Pack"));
        assert_eq!(pack.version.as_deref(), Some("1.2.3"));
        assert_eq!(pack.game_version.as_deref(), Some("1.21.1"));
        assert_eq!(
            pack.files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["mods/alpha.jar", "config/beta.toml"]
        );
    }

    #[test]
    fn skips_client_only_files() {
        // A client-only mod on a server is wasted bandwidth at best and stops it
        // booting at worst.
        let raw = br#"{
            "files": [
                { "path": "mods/server.jar", "downloads": ["https://cdn/s.jar"],
                  "env": { "client": "optional", "server": "required" } },
                { "path": "mods/client.jar", "downloads": ["https://cdn/c.jar"],
                  "env": { "client": "required", "server": "unsupported" } }
            ]
        }"#;

        let pack = parse_modrinth_index(raw).expect("index parses");

        assert_eq!(
            pack.files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["mods/server.jar"]
        );
    }

    #[test]
    fn skips_entries_with_no_download_url() {
        let raw = br#"{"files":[{"path":"mods/a.jar","downloads":[]}]}"#;

        assert!(parse_modrinth_index(raw).expect("parses").files.is_empty());
    }

    #[test]
    fn refuses_paths_that_escape_the_server_root() {
        // Manifests are third-party input.
        assert_eq!(safe_pack_path("../../etc/passwd"), None);
        assert_eq!(safe_pack_path("/etc/passwd"), None);
        assert_eq!(safe_pack_path("mods/../../escape.jar"), None);
        assert_eq!(safe_pack_path("..\\windows\\system32"), None);
        assert_eq!(safe_pack_path(""), None);
    }

    #[test]
    fn keeps_ordinary_nested_paths() {
        assert_eq!(
            safe_pack_path("config/sodium/options.json").as_deref(),
            Some("config/sodium/options.json")
        );
        assert_eq!(safe_pack_path("mods/a.jar").as_deref(), Some("mods/a.jar"));
    }

    #[test]
    fn a_traversing_index_entry_is_dropped_not_relocated() {
        let raw = br#"{
            "files": [
                { "path": "../../escape.jar", "downloads": ["https://cdn/e.jar"] },
                { "path": "mods/fine.jar", "downloads": ["https://cdn/f.jar"] }
            ]
        }"#;

        let pack = parse_modrinth_index(raw).expect("index parses");

        assert_eq!(
            pack.files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["mods/fine.jar"]
        );
    }

    #[test]
    fn parses_a_curseforge_manifest() {
        let raw = br#"{
            "minecraft": { "version": "1.21.1", "modLoaders": [{"id":"fabric-0.16.9"}] },
            "manifestType": "minecraftModpack",
            "name": "CF Pack",
            "version": "2.0",
            "files": [
                { "projectID": 238222, "fileID": 4712345, "required": true },
                { "projectID": 306612, "fileID": 5000001, "required": false }
            ],
            "overrides": "overrides"
        }"#;

        let pack = parse_curseforge_manifest(raw).expect("manifest parses");

        assert_eq!(pack.name.as_deref(), Some("CF Pack"));
        assert_eq!(pack.game_version.as_deref(), Some("1.21.1"));
        // Optional files are the pack author's opt-outs; only required ones ship.
        assert_eq!(
            pack.files
                .iter()
                .filter_map(|file| file.curseforge.clone())
                .collect::<Vec<_>>(),
            [("238222".to_owned(), "4712345".to_owned())]
        );
    }

    #[test]
    fn a_curseforge_entry_defaults_to_required() {
        let raw = br#"{"files":[{"projectID":1,"fileID":2}]}"#;

        assert_eq!(
            parse_curseforge_manifest(raw).expect("parses").files.len(),
            1
        );
    }

    #[test]
    fn an_unparseable_manifest_is_an_error_not_an_empty_pack() {
        // Treating a broken manifest as "no files" would silently install nothing
        // and report success.
        parse_modrinth_index(b"not json").expect_err("must not parse");
        parse_curseforge_manifest(b"{{{").expect_err("must not parse");
    }
}
