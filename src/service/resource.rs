use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::resources::{
    InstalledResource, delete_installed, delete_installed_files, installed_file, list_installed,
    upsert_installed,
};
use crate::db::server::{Server, ServerId};
use crate::resources::{
    MAX_QUERY_LENGTH, MAX_SEARCH_LIMIT, ResourceClient, ResourceError, ResourceKind,
    ResourceLoader, ResourceProject, ResourceProvider, ResourceQuery, ResourceType,
    ResourceVersion, ResourceVersionType,
};
use crate::service::resource::resource_service_error::{
    InstallResourceError, ListInstalledResourcesError, ListResourceUpdatesError,
    ListResourceVersionsError, ResourceContextError, SearchResourcesError, SetResourceStateError,
    UninstallResourceError, UpdateAllResourcesError, UpdateResourceError,
};
use crate::service::template::*;
use crate::service::{
    error_file_already_exists::FromFileAlreadyExists, error_file_is_directory::FromFileIsDirectory,
    error_file_not_found::FromFileNotFound, error_file_quota_exceeded::FromFileQuotaExceeded,
    error_file_sandbox_violated::FromFileSandboxViolated,
    error_file_storage_unavailable::FromFileStorageUnavailable,
    error_node_failure::FromNodeFailure,
    error_resource_download_unavailable::FromResourceDownloadUnavailable,
    error_resource_invalid_payload::FromResourceInvalidPayload,
    error_resource_missing::FromResourceMissing,
    error_resource_provider_disabled::FromResourceProviderDisabled,
    error_resource_provider_error::FromResourceProviderError,
    error_resource_provider_unavailable::FromResourceProviderUnavailable,
};
use crate::templates::games::minecraft::MinecraftTemplate;
use crate::templates::{Template as _, TemplateError};
use chrono::{DateTime, FixedOffset};
use daemon_common::files::FileMode;
use daemon_common::service::files::files_service_error::{
    ServerCreateDirectoryError, ServerDeleteFileError, ServerListFilesError, ServerRenameFileError,
    ServerWriteFileByUrlError,
};
use redis::RedisError;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::Path;
use tracing::{error, info, warn};
use zelus::service;

define_query_variable!(provider "The resource provider");
define_query_variable!(query "The search query");
define_query_variable!(loader "The mod/plugin loader to search for");
define_query_variable!(game_version "Restrict results to this Minecraft version");
define_query_variable!(project "The provider-scoped project id");
define_query_variable!(offset "The number of results to skip");
define_query_variable!(resource_type "The kind of resource (plugin, modification, data_pack)");
define_query_variable!(enabled "Whether the resource should be active");
define_query_variable!(kind "Whether to browse individual resources or modpacks");
define_query_variable!(
    allow_prerelease "Whether beta/alpha versions count as updates (default false)"
);

/// Default page size, matching what the browser shows without scrolling.
const DEFAULT_LIMIT: u8 = 24;

/// Longest title stored for an installed resource, matching the column width.
const MAX_TITLE_LENGTH: usize = 255;

/// Mask selecting the file-type bits out of a Unix mode.
const FILE_TYPE_MASK: u32 = 0xF000;

/// Suffix that parks a resource without deleting it. Paper, Fabric and Forge
/// all load by extension, so a `.jar.disabled` file is simply ignored — which
/// makes the on-disk name the whole state, with nothing to keep in sync.
const DISABLED_SUFFIX: &str = ".disabled";

/// Splits an on-disk name into its base name and whether it is active.
///
/// Case-insensitive, to stay consistent with [`is_resource_file`]: otherwise a
/// `Foo.jar.DISABLED` would be accepted as a resource but reported active, and
/// its record would be reconciled away as missing.
fn split_disabled(name: &str) -> (&str, bool) {
    if name.to_lowercase().ends_with(DISABLED_SUFFIX) {
        (
            name.get(..name.len() - DISABLED_SUFFIX.len())
                .unwrap_or(name),
            false,
        )
    } else {
        (name, true)
    }
}

/// The on-disk name a base name takes in the given state.
fn state_file_name(base: &str, enabled: bool) -> String {
    if enabled {
        base.to_owned()
    } else {
        format!("{base}{DISABLED_SUFFIX}")
    }
}

/// Which loaders a server can take resources for, and who serves them.
///
/// Derived from the template's enabled features so the frontend does not have
/// to keep its own copy of the feature-to-loader mapping.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceContext {
    pub(crate) loaders: Vec<ResourceLoaderInfo>,
    /// The Minecraft version the server runs, when the template reports one.
    /// Clients use it to pre-fill the compatibility filter.
    pub(crate) game_version: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceLoaderInfo {
    pub(crate) loader: ResourceLoader,
    pub(crate) resource_type: ResourceType,
    /// Providers that both serve this loader and are configured here.
    pub(crate) providers: Vec<ResourceProvider>,
    /// Providers that also carry modpacks for this loader. Empty for Paper,
    /// which has no modpack concept.
    pub(crate) modpack_providers: Vec<ResourceProvider>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct InstallResourcePayload {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) loader: ResourceLoader,
    /// Shown in the installed list; falls back to the project id.
    #[serde(default)]
    pub(crate) title: Option<String>,
}

/// Maps a template feature onto the loader it enables.
const FEATURE_LOADERS: [(&str, ResourceLoader); 4] = [
    ("minecraft_plugins_paper", ResourceLoader::Paper),
    ("minecraft_mods_fabric", ResourceLoader::Fabric),
    ("minecraft_mods_forge", ResourceLoader::Forge),
    ("minecraft_mods_neoforge", ResourceLoader::Neoforge),
];

/// What the resource directories actually hold.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstalledResources {
    /// Resources installed through the browser, reconciled against disk.
    pub(crate) managed: Vec<InstalledResource>,
    /// Resource files present on disk that no record points at — uploaded over
    /// SFTP, dropped in via the file manager, or replaced by hand. Listed so the
    /// panel reflects the directory rather than only our own bookkeeping.
    pub(crate) unmanaged: Vec<UnmanagedResource>,
    /// Directories that could not be read, so neither list above is complete for
    /// them. Lets a client say "couldn't check" instead of "nothing there".
    pub(crate) unreadable: Vec<ResourceType>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct UnmanagedResource {
    pub(crate) resource_type: ResourceType,
    /// The name as it appears on disk, so a parked file reads as
    /// `Foo.jar.disabled`.
    pub(crate) file_name: String,
    pub(crate) size: u64,
    pub(crate) enabled: bool,
}

/// An installed resource that has a newer version available.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceUpdate {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) title: String,
    pub(crate) installed_version: String,
    pub(crate) latest_version: String,
    pub(crate) latest_version_number: String,
    pub(crate) latest_version_type: ResourceVersionType,
    pub(crate) latest_published_at: Option<String>,
    /// `false` when the newest version cannot be fetched automatically, so the
    /// update has to be done by hand.
    pub(crate) downloadable: bool,
}

/// The outcome of one resource in a batch update.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceUpdateResult {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) title: String,
    /// The version now installed, when it worked.
    pub(crate) version: Option<String>,
    /// Why it did not update, when it did not.
    pub(crate) error: Option<String>,
}

/// The state a resource file ended up in.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceState {
    pub(crate) resource_type: ResourceType,
    pub(crate) file_name: String,
    pub(crate) enabled: bool,
}

/// One directory's contents: the resource files in it, or `None` when it could
/// not be read.
type Listing = Option<Vec<(String, u64)>>;

/// Whether a listing entry is a plain file (not a directory or symlink).
///
/// Plugin directories are full of per-plugin data folders, so this matters.
const fn is_regular_file(mode: u32) -> bool {
    mode & FILE_TYPE_MASK == FileMode::REG.bits()
}

/// Whether a file name looks like an installable artifact for `resource_type`.
///
/// Keeps `config.yml`, logs and stray files out of the unmanaged list.
fn is_resource_file(resource_type: ResourceType, name: &str) -> bool {
    let lower = name.to_lowercase();
    // `.jar.disabled` is the conventional way to park a plugin without deleting
    // it, so it still counts as a resource file.
    let base = lower.strip_suffix(".disabled").unwrap_or(lower.as_str());
    let extension = Path::new(base).extension().and_then(OsStr::to_str);

    match resource_type {
        ResourceType::Plugin | ResourceType::Modification => extension == Some("jar"),
        ResourceType::DataPack => extension == Some("zip"),
    }
}

/// Resource files on disk that no record claims.
///
/// Records store the base name, so both `Foo.jar` and `Foo.jar.disabled` count
/// as claimed by a record for `Foo.jar` — otherwise disabling a managed plugin
/// would make it show up as somebody else's file.
fn collect_unmanaged(
    listings: &HashMap<ResourceType, Listing>,
    managed: &[InstalledResource],
) -> Vec<UnmanagedResource> {
    let claimed: HashSet<(ResourceType, &str)> = managed
        .iter()
        .map(|resource| (resource.resource_type, resource.file_name.as_str()))
        .collect();

    let mut unmanaged = Vec::new();
    for (resource_type, listing) in listings {
        let Some(files) = listing.as_ref() else {
            continue;
        };
        for (name, size) in files {
            let (base, enabled) = split_disabled(name);
            if is_resource_file(*resource_type, name) && !claimed.contains(&(*resource_type, base))
            {
                unmanaged.push(UnmanagedResource {
                    resource_type: *resource_type,
                    file_name: name.clone(),
                    size: *size,
                    enabled,
                });
            }
        }
    }

    unmanaged.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    unmanaged
}

/// Splits records into (still on disk, gone from disk), resolving each surviving
/// record's `enabled` flag from the name actually found.
///
/// A record matches either `Foo.jar` or `Foo.jar.disabled`, so parking a plugin
/// — through this service or by hand over SFTP — keeps its provider/version
/// history instead of reading as a removal.
///
/// `listings` maps a directory to the files in it, or to `None` when it could
/// not be read. An unreadable directory is not evidence of removal, so its
/// records are kept untouched — that is what keeps an unreachable node from
/// wiping the install history. A directory that is missing entirely is readable
/// *and* empty, and belongs in the map as `Some(empty)`.
fn partition_present(
    recorded: Vec<InstalledResource>,
    listings: &HashMap<ResourceType, Listing>,
) -> (Vec<InstalledResource>, Vec<InstalledResource>) {
    let mut present = Vec::new();
    let mut missing = Vec::new();

    for mut resource in recorded {
        let Some(files) = listings
            .get(&resource.resource_type)
            .and_then(Option::as_ref)
        else {
            // Nothing is known about the directory, so nothing is concluded.
            present.push(resource);
            continue;
        };

        // Split each name found rather than building the one expected, so the
        // suffix is matched on the same (case-insensitive) terms everywhere.
        // Base names stay an exact match: file names are case-sensitive.
        let mut has_active = false;
        let mut has_parked = false;
        for (name, _size) in files {
            let (base, enabled) = split_disabled(name);
            if base == resource.file_name {
                if enabled {
                    has_active = true;
                } else {
                    has_parked = true;
                }
            }
        }

        if has_active || has_parked {
            resource.enabled = has_active;
            present.push(resource);
        } else {
            missing.push(resource);
        }
    }

    (present, missing)
}

/// Everything that can go wrong writing a resource onto a server.
///
/// The install path is shared by three routes with different generated error
/// enums, so it reports through one type that is mapped once per route — the
/// same shape as [`ResourceError::into`] and `TemplateError::into`.
#[derive(Debug)]
pub(crate) enum InstallError {
    Resource(ResourceError),
    /// The resolved file is not an artifact this directory can load — a modpack
    /// archive rather than a mod, for instance.
    UnexpectedFileType,
    Node,
    StorageUnavailable,
    FileNotFound,
    SandboxViolated,
    IsDirectory,
    QuotaExceeded,
    AlreadyExists,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for InstallError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(value)
    }
}

impl InstallError {
    /// Short, stable reason for per-item reporting in a batch update, where one
    /// failure must not sink the whole response.
    pub(crate) const fn reason(&self) -> &'static str {
        match self {
            Self::Resource(resource) => resource.reason(),
            Self::UnexpectedFileType => "The provider returned a file that is not a mod or plugin",
            Self::Node => "The node could not be reached",
            Self::StorageUnavailable => "Storage is currently in use",
            Self::FileNotFound => "The target directory is missing",
            Self::SandboxViolated => "The target path is outside the server",
            Self::IsDirectory => "A directory is in the way",
            Self::QuotaExceeded => "The server storage quota is full",
            Self::AlreadyExists => "A file is already in the way",
            Self::Database(_) => "The installation could not be recorded",
        }
    }

    pub(crate) fn into<
        E: FromResourceInvalidPayload
            + FromResourceProviderUnavailable
            + FromResourceProviderError
            + FromResourceProviderDisabled
            + FromResourceDownloadUnavailable
            + FromResourceMissing
            + FromNodeFailure
            + FromFileStorageUnavailable
            + FromFileNotFound
            + FromFileSandboxViolated
            + FromFileIsDirectory
            + FromFileQuotaExceeded
            + FromFileAlreadyExists
            + From<RedisError>
            + From<sqlx::Error>,
    >(
        self,
    ) -> E {
        match self {
            Self::Resource(resource) => resource.into::<E>(),
            Self::UnexpectedFileType => <E as FromResourceInvalidPayload>::from(),
            Self::Node => <E as FromNodeFailure>::from(),
            Self::StorageUnavailable => <E as FromFileStorageUnavailable>::from(),
            Self::FileNotFound => <E as FromFileNotFound>::from(),
            Self::SandboxViolated => <E as FromFileSandboxViolated>::from(),
            Self::IsDirectory => <E as FromFileIsDirectory>::from(),
            Self::QuotaExceeded => <E as FromFileQuotaExceeded>::from(),
            Self::AlreadyExists => <E as FromFileAlreadyExists>::from(),
            Self::Database(err) => <E as From<sqlx::Error>>::from(err),
        }
    }
}

/// The newest version in a provider's list.
///
/// Providers mostly return newest-first, but none of them contract to, so this
/// prefers the publish timestamp where one is given and falls back to the
/// provider's own order. There is no version ordering that holds across four
/// providers, so an "update" is defined as *the newest published version differs
/// from the installed one* rather than as a semver comparison.
///
/// Pre-releases are skipped unless `allow_prerelease` is set: "update all" is a
/// bulk mutation of a live server, and quietly moving every mod onto the latest
/// beta is not what it should do. A project with nothing but pre-releases still
/// reports one, since otherwise it could never be updated at all.
fn newest_version(
    versions: Vec<ResourceVersion>,
    allow_prerelease: bool,
) -> Option<ResourceVersion> {
    fn newest(versions: Vec<ResourceVersion>) -> Option<ResourceVersion> {
        let mut best: Option<(Option<DateTime<FixedOffset>>, ResourceVersion)> = None;

        for version in versions {
            let stamp = version
                .published_at
                .as_deref()
                .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok());

            let replace = match &best {
                None => true,
                // Only a comparable pair of timestamps can displace the
                // incumbent; otherwise the provider's ordering stands.
                Some((Some(current), _)) => stamp.is_some_and(|candidate| candidate > *current),
                Some((None, _)) => false,
            };

            if replace {
                best = Some((stamp, version));
            }
        }

        best.map(|(_stamp, version)| version)
    }

    if allow_prerelease {
        return newest(versions);
    }

    let (releases, prereleases): (Vec<_>, Vec<_>) = versions
        .into_iter()
        .partition(|version| matches!(version.version_type, ResourceVersionType::Release));

    newest(releases).or_else(|| newest(prereleases))
}

/// Removes a resource file, whether it is currently active or parked.
///
/// A disabled plugin lives under `.jar.disabled`, so deleting only the base name
/// would leave it on disk. Neither form being present is success: the caller is
/// removing it either way.
async fn remove_resource_file(
    server: &Server,
    resource_type: ResourceType,
    base: &str,
) -> Result<(), ServerDeleteFileError> {
    let prefix = resource_type.path_prefix();

    match server
        .node
        .server_delete_file(server.node_server_id, format!("{prefix}{base}"), false)
        .await
    {
        Err(ServerDeleteFileError::FileNotFound) => {
            match server
                .node
                .server_delete_file(
                    server.node_server_id,
                    format!("{prefix}{}", state_file_name(base, false)),
                    false,
                )
                .await
            {
                Err(ServerDeleteFileError::FileNotFound) => Ok(()),
                other => other,
            }
        }
        other => other,
    }
}

impl Backend {
    fn resource_client(&self) -> ResourceClient<'_> {
        ResourceClient {
            http: &self.http_client,
            cache: self.cache.clone(),
            curseforge_api_key: self.curseforge_api_key.as_deref(),
        }
    }

    /// The loader each resource type resolves to on this server, plus the
    /// Minecraft version to stay compatible with.
    ///
    /// Updates have to be filtered to the server's own loader and game version,
    /// or the "latest" version offered could be one the server cannot run.
    async fn update_target(
        &self,
        server: &Server,
    ) -> Result<(HashMap<ResourceType, ResourceLoader>, Option<String>), TemplateError> {
        let features = server
            .template
            .enabled_features(self.cache.clone(), server.template_extra.clone())
            .await?;

        let loaders = FEATURE_LOADERS
            .into_iter()
            .filter(|(feature, _)| features.contains(feature))
            .map(|(_, loader)| (loader.resource_type(), loader))
            .collect();

        let game_version = server
            .template_extra
            .get("minecraft_version")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);

        Ok((loaders, game_version))
    }

    /// The newest version available for an installed resource, or `None` when it
    /// is already the newest (or nothing compatible could be found).
    async fn available_update(
        &self,
        resource: &InstalledResource,
        loaders: &HashMap<ResourceType, ResourceLoader>,
        game_version: Option<&str>,
        allow_prerelease: bool,
    ) -> Option<ResourceVersion> {
        let loader = *loaders.get(&resource.resource_type)?;
        if !resource.provider.supports(loader, ResourceKind::Resource) {
            return None;
        }

        let versions = self
            .resource_client()
            .versions(
                resource.provider,
                &resource.project,
                loader,
                ResourceKind::Resource,
                game_version,
            )
            .await
            .inspect_err(|err| {
                // One unreachable provider must not sink the whole report.
                warn!(
                    "Failed to check updates for {}/{}: {err:?}",
                    resource.provider.as_str(),
                    resource.project
                );
            })
            .ok()?;

        newest_version(versions, allow_prerelease).filter(|latest| latest.id != resource.version)
    }

    /// Downloads `version` onto `server` and records it as installed.
    ///
    /// Shared by install and update: an update is an install of a newer version
    /// over the same `(provider, project)` record, with exactly the same
    /// replace-then-clean-up semantics.
    async fn install_version(
        &self,
        server: &Server,
        provider: ResourceProvider,
        project: &str,
        version: &str,
        loader: ResourceLoader,
        title: Option<String>,
    ) -> Result<InstalledResource, InstallError> {
        if !provider.supports(loader, ResourceKind::Resource) {
            return Err(InstallError::Resource(ResourceError::InvalidPayload));
        }

        let resource_type = loader.resource_type();
        let resolved = self
            .resource_client()
            .resolve(provider, project, version)
            .await
            .map_err(InstallError::Resource)?;

        // Guards the modpack case: browsing modpacks means a client can name a
        // modpack project here, and its `.mrpack`/`.zip` archive would be written
        // into `mods/` where nothing would ever load it. Checking the resolved
        // artifact rather than a client-declared kind means this holds however
        // the request was built.
        if !is_resource_file(resource_type, &resolved.file_name) {
            warn!(
                "Refusing to install {} as a {}: not a loadable artifact",
                resolved.file_name,
                resource_type.as_str()
            );
            return Err(InstallError::UnexpectedFileType);
        }

        let previous = installed_file(&self.database, server.id, provider, project).await?;

        server
            .node
            .server_create_directory(
                server.node_server_id,
                resource_type.path_prefix().to_owned(),
                true,
            )
            .await
            .map_err(|err| match err {
                ServerCreateDirectoryError::Communication(_) => {
                    error!("Failed to request directory creation for resource: {err:?}");
                    InstallError::Node
                }
                ServerCreateDirectoryError::AuthInvalid
                | ServerCreateDirectoryError::StorageNotFound
                | ServerCreateDirectoryError::StorageFailure
                | ServerCreateDirectoryError::SqlFailure => {
                    error!("Failed to create directory for resource: {err:?}");
                    InstallError::Node
                }
                ServerCreateDirectoryError::StorageMutexLocked => InstallError::StorageUnavailable,
                ServerCreateDirectoryError::FileNotFound => InstallError::FileNotFound,
                ServerCreateDirectoryError::FileSandboxViolated => InstallError::SandboxViolated,
                ServerCreateDirectoryError::FileAlreadyExists => InstallError::AlreadyExists,
                ServerCreateDirectoryError::StorageQuotaReached => InstallError::QuotaExceeded,
            })?;

        let path = format!("{}{}", resource_type.path_prefix(), resolved.file_name);

        server
            .node
            .server_write_file_by_url(server.node_server_id, path, resolved.url)
            .await
            .map_err(|err| match err {
                ServerWriteFileByUrlError::Communication(_) => {
                    error!("Failed to request file upload (by URL) for resource: {err:?}");
                    InstallError::Node
                }
                ServerWriteFileByUrlError::AuthInvalid
                | ServerWriteFileByUrlError::StorageNotFound
                | ServerWriteFileByUrlError::StorageFailure
                | ServerWriteFileByUrlError::SqlFailure => {
                    error!("Failed to upload file (by URL) for resource: {err:?}");
                    InstallError::Node
                }
                ServerWriteFileByUrlError::StorageMutexLocked => InstallError::StorageUnavailable,
                ServerWriteFileByUrlError::StorageQuotaReached => InstallError::QuotaExceeded,
                ServerWriteFileByUrlError::FileNotFound => InstallError::FileNotFound,
                ServerWriteFileByUrlError::FileSandboxViolated => InstallError::SandboxViolated,
                ServerWriteFileByUrlError::FileIsDirectory => InstallError::IsDirectory,
                ServerWriteFileByUrlError::HttpRequestFailed
                | ServerWriteFileByUrlError::HttpRequestReadFailed
                | ServerWriteFileByUrlError::HttpRequestNotSuccess => {
                    InstallError::Resource(ResourceError::ProviderUnavailable)
                }
            })?;

        // Superseded files only go once the new one is on disk. Failures here
        // leave a stale file behind, which is recoverable through the file
        // manager, so they must not fail the install.
        //
        // The write above lands on the active name, so a parked copy of that
        // same name is now a stale duplicate — and leaving it would make the
        // resource impossible to disable afterwards. It has to go even when the
        // file name did not change, which is why this is not folded into the
        // `previous_file` case below.
        let parked = format!(
            "{}{}",
            resource_type.path_prefix(),
            state_file_name(&resolved.file_name, false)
        );
        match server
            .node
            .server_delete_file(server.node_server_id, parked.clone(), false)
            .await
        {
            Ok(()) | Err(ServerDeleteFileError::FileNotFound) => {}
            Err(err) => warn!("Failed to remove superseded parked resource {parked}: {err:?}"),
        }

        // A previous file under a different name is a leftover of the old
        // version, in whichever state it was left.
        if let Some((previous_file, previous_type)) = previous
            && previous_file != resolved.file_name
            && let Err(err) = remove_resource_file(server, previous_type, &previous_file).await
        {
            warn!("Failed to remove replaced resource {previous_file}: {err:?}");
        }

        let installed = InstalledResource {
            // The column is varchar(255); an over-long title would fail the
            // upsert *after* the file is on disk, orphaning it.
            title: title.map_or_else(
                || project.to_owned(),
                |title| title.chars().take(MAX_TITLE_LENGTH).collect(),
            ),
            provider,
            project: project.to_owned(),
            version: version.to_owned(),
            resource_type,
            file_name: resolved.file_name,
            // Install always writes the active name.
            enabled: true,
            installed_at: chrono::Utc::now().timestamp(),
        };

        upsert_installed(&self.database, server.id, &installed).await?;

        Ok(installed)
    }
}

#[service(path = "/resource/{server_id}", tag = "resource", no_sdk)]
pub(crate) impl ResourceService for Backend {
    /// Reports which loaders and providers this server can browse.
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::wrong_template, template::{corrupted, unavailable})]
    async fn resource_context(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<ResourceContext, _> {
        auth.require::<_, _, ResourceContextError>(server_id, ServerPermissions::FILES_READ)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ResourceContextError::ServerNotFound)?;

        if server.template.id() != MinecraftTemplate::ID {
            return Err(ResourceContextError::ResourceWrongTemplate);
        }

        let features = server
            .template
            .enabled_features(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<ResourceContextError>)?;

        let available = self.resource_client().available();
        let loaders = FEATURE_LOADERS
            .into_iter()
            .filter(|(feature, _)| features.contains(feature))
            .map(|(_, loader)| ResourceLoaderInfo {
                loader,
                resource_type: loader.resource_type(),
                providers: available
                    .iter()
                    .copied()
                    .filter(|provider| provider.supports(loader, ResourceKind::Resource))
                    .collect(),
                modpack_providers: available
                    .iter()
                    .copied()
                    .filter(|provider| provider.supports(loader, ResourceKind::Modpack))
                    .collect(),
            })
            .collect();

        Ok(ResourceContext {
            loaders,
            // Every Minecraft variant stores the version under the same key, so
            // this reads it without having to know which variant it is.
            game_version: server
                .template_extra
                .get("minecraft_version")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
        })
    }

    /// Searches a provider for projects compatible with `loader`.
    ///
    /// Results are normalized across providers and cached in Valkey, so a
    /// typing burst in the search box costs one upstream request per distinct
    /// query rather than one per keystroke per client.
    #[route("/search", method = GET, query = [ provider, query, loader, kind, game_version, limit, offset ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing})]
    async fn search_resources(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        provider: ResourceProvider,
        query: Option<String>,
        loader: ResourceLoader,
        kind: Option<ResourceKind>,
        game_version: Option<String>,
        limit: Option<u8>,
        offset: Option<u32>,
    ) -> Result<Vec<ResourceProject>, _> {
        auth.require::<_, _, SearchResourcesError>(server_id, ServerPermissions::FILES_READ)?;

        let query = query.unwrap_or_default();
        if query.len() > MAX_QUERY_LENGTH {
            return Err(SearchResourcesError::ResourceInvalidPayload);
        }

        self.resource_client()
            .search(
                provider,
                &ResourceQuery {
                    query,
                    loader,
                    kind: kind.unwrap_or(ResourceKind::Resource),
                    game_version: game_version.filter(|version| !version.is_empty()),
                    limit: limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_SEARCH_LIMIT),
                    offset: offset.unwrap_or_default(),
                },
            )
            .await
            .map_err(ResourceError::into::<SearchResourcesError>)
    }

    /// Lists the versions of a project that fit `loader`.
    #[route("/versions", method = GET, query = [ provider, project, loader, kind, game_version ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing})]
    async fn list_resource_versions(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        provider: ResourceProvider,
        project: String,
        loader: ResourceLoader,
        kind: Option<ResourceKind>,
        game_version: Option<String>,
    ) -> Result<Vec<ResourceVersion>, _> {
        auth.require::<_, _, ListResourceVersionsError>(server_id, ServerPermissions::FILES_READ)?;

        self.resource_client()
            .versions(
                provider,
                &project,
                loader,
                kind.unwrap_or(ResourceKind::Resource),
                game_version
                    .as_deref()
                    .filter(|version| !version.is_empty()),
            )
            .await
            .map_err(ResourceError::into::<ListResourceVersionsError>)
    }

    /// Lists what is on this server: browser-installed resources, plus resource
    /// files nothing has a record for.
    ///
    /// The `server_resources` table carries the provider/project/version
    /// identity that file names cannot express, but the files themselves are the
    /// truth: anyone can add, delete or rename a jar over SFTP or in the file
    /// manager, and none of that goes through this service. So the directories
    /// are listed on every read, records whose file is gone are dropped — a
    /// resource the user removed by hand is not installed, however it was
    /// removed — and files no record claims are reported as `unmanaged` instead
    /// of being invisible.
    ///
    /// Reconciliation only ever deletes on an authoritative answer (a listing
    /// that succeeded, or a directory that does not exist and therefore holds
    /// nothing). Any other daemon fault leaves the records untouched and names
    /// the directory in `unreadable`, so an unreachable node degrades to
    /// "couldn't check" instead of discarding the version history.
    #[route("/installed", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, template::{corrupted, unavailable})]
    async fn list_installed_resources(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<InstalledResources, _> {
        auth.require::<_, _, ListInstalledResourcesError>(
            server_id,
            ServerPermissions::FILES_READ,
        )?;

        let recorded = list_installed(&self.database, server_id).await?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ListInstalledResourcesError::ServerNotFound)?;

        // Which directories to look at comes from the template, not from the
        // records: a server with nothing recorded can still hold hand-uploaded
        // jars, and those are exactly what `unmanaged` is for. Stale records
        // pointing at a directory the template no longer uses are included too,
        // so they can still be reconciled away.
        let mut directories: HashSet<ResourceType> = server
            .template
            .enabled_features(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<ListInstalledResourcesError>)?
            .iter()
            .filter_map(|feature| {
                FEATURE_LOADERS
                    .iter()
                    .find(|(candidate, _)| candidate == feature)
                    .map(|(_, loader)| loader.resource_type())
            })
            .collect();
        directories.extend(recorded.iter().map(|resource| resource.resource_type));

        let mut listings: HashMap<ResourceType, Listing> = HashMap::new();
        let mut unreadable = Vec::new();
        for resource_type in directories {
            let listing = match server
                .node
                .server_list_files(server.node_server_id, resource_type.directory())
                .await
            {
                Ok(entries) => Some(
                    entries
                        .into_iter()
                        .filter(|entry| is_regular_file(entry.mode))
                        .map(|entry| (entry.name, entry.size))
                        .collect::<Vec<_>>(),
                ),
                // The directory itself is gone, so nothing in it survives.
                Err(ServerListFilesError::FileNotFound) => Some(Vec::new()),
                Err(err) => {
                    warn!(
                        "Skipping resource reconciliation for {}: {err:?}",
                        resource_type.directory()
                    );
                    unreadable.push(resource_type);
                    None
                }
            };
            listings.insert(resource_type, listing);
        }

        let (present, missing) = partition_present(recorded, &listings);

        if !missing.is_empty() {
            let files: Vec<String> = missing
                .iter()
                .map(|resource| resource.file_name.clone())
                .collect();
            info!(
                "Forgetting {} resource(s) removed outside the panel on server {server_id}: {files:?}",
                files.len()
            );
            // A failed cleanup must not fail the read: the response already
            // reflects the filesystem, and the next read retries the delete.
            if let Err(err) = delete_installed_files(&self.database, server_id, &files).await {
                warn!("Failed to forget removed resources: {err:?}");
            }
        }

        Ok(InstalledResources {
            unmanaged: collect_unmanaged(&listings, &present),
            managed: present,
            unreadable,
        })
    }

    /// Downloads a version onto the server and records it as installed.
    ///
    /// Installing over an already-installed project replaces it: the new file
    /// is written first, then the previous one is removed, so a failed download
    /// leaves the working version in place.
    #[route("/install", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing, wrong_template}, file::{storage_unavailable, not_found, sandbox_violated, is_directory, quota_exceeded, already_exists})]
    async fn install_resource(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        payload: InstallResourcePayload,
    ) -> Result<InstalledResource, _> {
        auth.require::<_, _, InstallResourceError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(InstallResourceError::ServerNotFound)?;

        if server.template.id() != MinecraftTemplate::ID {
            return Err(InstallResourceError::ResourceWrongTemplate);
        }

        self.install_version(
            &server,
            payload.provider,
            &payload.project,
            &payload.version,
            payload.loader,
            payload.title,
        )
        .await
        .map_err(InstallError::into::<InstallResourceError>)
    }

    /// Lists installed resources that have a newer version available.
    ///
    /// Checked against the server's own loader and Minecraft version, so an
    /// offered update is one the server can actually run. Each provider lookup
    /// goes through the Valkey cache, so repeat visits are nearly free; a
    /// provider that cannot be reached is skipped rather than failing the report.
    #[route("/updates", method = GET, query = [ allow_prerelease ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, template::{corrupted, unavailable})]
    async fn list_resource_updates(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        allow_prerelease: Option<bool>,
    ) -> Result<Vec<ResourceUpdate>, _> {
        auth.require::<_, _, ListResourceUpdatesError>(server_id, ServerPermissions::FILES_READ)?;

        let recorded = list_installed(&self.database, server_id).await?;
        if recorded.is_empty() {
            return Ok(Vec::new());
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ListResourceUpdatesError::ServerNotFound)?;

        let (loaders, game_version) = self
            .update_target(&server)
            .await
            .map_err(TemplateError::into::<ListResourceUpdatesError>)?;

        let mut updates = Vec::new();
        for resource in recorded {
            let Some(latest) = self
                .available_update(
                    &resource,
                    &loaders,
                    game_version.as_deref(),
                    allow_prerelease.unwrap_or(false),
                )
                .await
            else {
                continue;
            };

            updates.push(ResourceUpdate {
                provider: resource.provider,
                project: resource.project,
                title: resource.title,
                installed_version: resource.version,
                latest_version: latest.id,
                latest_version_number: latest.version_number,
                latest_version_type: latest.version_type,
                latest_published_at: latest.published_at,
                downloadable: latest.downloadable,
            });
        }

        Ok(updates)
    }

    /// Updates one installed resource to the newest compatible version.
    #[route("/update", method = POST, query = [ provider, project, allow_prerelease ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, template::{corrupted, unavailable}, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing, not_installed, wrong_template}, file::{storage_unavailable, not_found, sandbox_violated, is_directory, quota_exceeded, already_exists})]
    async fn update_resource(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        provider: ResourceProvider,
        project: String,
        allow_prerelease: Option<bool>,
    ) -> Result<InstalledResource, _> {
        auth.require::<_, _, UpdateResourceError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateResourceError::ServerNotFound)?;

        if server.template.id() != MinecraftTemplate::ID {
            return Err(UpdateResourceError::ResourceWrongTemplate);
        }

        let resource = list_installed(&self.database, server_id)
            .await?
            .into_iter()
            .find(|candidate| candidate.provider == provider && candidate.project == project)
            .ok_or(UpdateResourceError::ResourceNotInstalled)?;

        let (loaders, game_version) = self
            .update_target(&server)
            .await
            .map_err(TemplateError::into::<UpdateResourceError>)?;

        let latest = self
            .available_update(
                &resource,
                &loaders,
                game_version.as_deref(),
                allow_prerelease.unwrap_or(false),
            )
            .await
            // Nothing newer to install; the caller is already current.
            .ok_or(UpdateResourceError::ResourceMissing)?;
        let loader = *loaders
            .get(&resource.resource_type)
            .ok_or(UpdateResourceError::ResourceInvalidPayload)?;

        self.install_version(
            &server,
            provider,
            &project,
            &latest.id,
            loader,
            Some(resource.title),
        )
        .await
        .map_err(InstallError::into::<UpdateResourceError>)
    }

    /// Updates every installed resource that has a newer compatible version.
    ///
    /// Reports per resource instead of failing as a whole: with a dozen mods from
    /// four providers, one unreachable provider or one distribution-blocked file
    /// should not stop the rest from updating.
    #[route("/update-all", method = POST, query = [ allow_prerelease ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::wrong_template, template::{corrupted, unavailable})]
    async fn update_all_resources(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        allow_prerelease: Option<bool>,
    ) -> Result<Vec<ResourceUpdateResult>, _> {
        auth.require::<_, _, UpdateAllResourcesError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateAllResourcesError::ServerNotFound)?;

        if server.template.id() != MinecraftTemplate::ID {
            return Err(UpdateAllResourcesError::ResourceWrongTemplate);
        }

        let recorded = list_installed(&self.database, server_id).await?;
        let (loaders, game_version) = self
            .update_target(&server)
            .await
            .map_err(TemplateError::into::<UpdateAllResourcesError>)?;

        let mut results = Vec::new();
        for resource in recorded {
            let Some(latest) = self
                .available_update(
                    &resource,
                    &loaders,
                    game_version.as_deref(),
                    allow_prerelease.unwrap_or(false),
                )
                .await
            else {
                continue;
            };
            let Some(loader) = loaders.get(&resource.resource_type).copied() else {
                continue;
            };

            let outcome = self
                .install_version(
                    &server,
                    resource.provider,
                    &resource.project,
                    &latest.id,
                    loader,
                    Some(resource.title.clone()),
                )
                .await;

            results.push(match outcome {
                Ok(installed) => ResourceUpdateResult {
                    provider: resource.provider,
                    project: resource.project,
                    title: resource.title,
                    version: Some(installed.version),
                    error: None,
                },
                Err(err) => {
                    warn!(
                        "Failed to update {}/{} on server {server_id}: {err:?}",
                        resource.provider.as_str(),
                        resource.project
                    );
                    ResourceUpdateResult {
                        provider: resource.provider,
                        project: resource.project,
                        title: resource.title,
                        version: None,
                        error: Some(err.reason().to_owned()),
                    }
                }
            });
        }

        Ok(results)
    }

    /// Removes an installed resource's file and its record.
    #[route("/installed", method = DELETE, query = [ provider, project ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, resource::not_installed, file::{storage_unavailable, sandbox_violated, is_directory, not_directory, not_found})]
    async fn uninstall_resource(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        provider: ResourceProvider,
        project: String,
    ) -> Result<(), _> {
        auth.require::<_, _, UninstallResourceError>(server_id, ServerPermissions::FILES_WRITE)?;

        let (file_name, resource_type) =
            installed_file(&self.database, server_id, provider, &project)
                .await?
                .ok_or(UninstallResourceError::ResourceNotInstalled)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UninstallResourceError::ServerNotFound)?;

        // Removes whichever of the active/parked names is there. Already gone on
        // disk is success too: the record is the stale thing, so dropping it
        // below is exactly the right outcome.
        match remove_resource_file(&server, resource_type, &file_name).await {
            Ok(()) => {}
            Err(err) => {
                return Err(match err {
                    ServerDeleteFileError::Communication(_) => {
                        error!("Failed to request resource delete: {err:?}");
                        UninstallResourceError::NodeFailure
                    }
                    ServerDeleteFileError::StorageMutexLocked => {
                        UninstallResourceError::FileStorageUnavailable
                    }
                    ServerDeleteFileError::FileSandboxViolated => {
                        UninstallResourceError::FileSandboxViolated
                    }
                    ServerDeleteFileError::FileIsDirectory => {
                        UninstallResourceError::FileIsDirectory
                    }
                    ServerDeleteFileError::FileNotDirectory => {
                        UninstallResourceError::FileNotDirectory
                    }
                    ServerDeleteFileError::FileNotFound
                    | ServerDeleteFileError::AuthInvalid
                    | ServerDeleteFileError::StorageNotFound
                    | ServerDeleteFileError::StorageFailure
                    | ServerDeleteFileError::SqlFailure => {
                        error!("Failed to delete resource file: {err:?}");
                        UninstallResourceError::NodeFailure
                    }
                });
            }
        }

        delete_installed(&self.database, server_id, provider, &project).await?;

        Ok(())
    }

    /// Enables or disables a resource file by moving it in or out of the
    /// `.jar.disabled` name the server ignores.
    ///
    /// Keyed by file rather than by provider/project, so it works the same for
    /// browser-installed resources and for jars that were uploaded by hand —
    /// `file` may be given in either state. Nothing is written to the database:
    /// the suffix on the file is the state, and reconciliation reads it back.
    ///
    /// Idempotent — asking for the state a file is already in succeeds without
    /// touching the filesystem.
    #[route("/state", method = POST, query = [ resource_type, file, enabled ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, resource::invalid_payload, file::{storage_unavailable, not_found, not_directory, sandbox_violated, already_exists})]
    async fn set_resource_state(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        resource_type: ResourceType,
        file: String,
        enabled: bool,
    ) -> Result<ResourceState, _> {
        auth.require::<_, _, SetResourceStateError>(server_id, ServerPermissions::FILES_WRITE)?;

        // Data packs are zips loaded by directory scan; `.zip.disabled` is not a
        // convention Minecraft honours, so there is nothing to toggle.
        if matches!(resource_type, ResourceType::DataPack) {
            return Err(SetResourceStateError::ResourceInvalidPayload);
        }

        // The caller may name the file in either state; only the base matters.
        let (base, _) = split_disabled(&file);
        // A bare file name inside the resource directory, nothing else: no
        // separators, no traversal, and it has to look like a resource.
        if base.is_empty()
            || base.len() > 255
            || base.contains('/')
            || base.contains('\\')
            || base.contains("..")
            || !is_resource_file(resource_type, base)
        {
            return Err(SetResourceStateError::ResourceInvalidPayload);
        }
        let base = base.to_owned();

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(SetResourceStateError::ServerNotFound)?;

        // Read the directory first so the outcome is decided from what is
        // actually there: that makes the no-op case explicit instead of
        // inferring it from a rename failure.
        let present = server
            .node
            .server_list_files(server.node_server_id, resource_type.directory())
            .await
            .map_err(|err| match err {
                ServerListFilesError::Communication(_) => {
                    error!("Failed to request resource listing: {err:?}");
                    SetResourceStateError::NodeFailure
                }
                ServerListFilesError::StorageMutexLocked => {
                    SetResourceStateError::FileStorageUnavailable
                }
                ServerListFilesError::FileNotFound => SetResourceStateError::FileNotFound,
                ServerListFilesError::FileSandboxViolated => {
                    SetResourceStateError::FileSandboxViolated
                }
                ServerListFilesError::FileNotDirectory => SetResourceStateError::FileNotDirectory,
                ServerListFilesError::AuthInvalid
                | ServerListFilesError::StorageNotFound
                | ServerListFilesError::StorageFailure
                | ServerListFilesError::SqlFailure => {
                    error!("Failed to list resources: {err:?}");
                    SetResourceStateError::NodeFailure
                }
            })?;

        let target = state_file_name(&base, enabled);
        let current = state_file_name(&base, !enabled);
        let exists = |wanted: &str| {
            present
                .iter()
                .any(|entry| entry.name == wanted && is_regular_file(entry.mode))
        };

        if exists(&target) {
            // Both names present. Reporting success here would be a lie for a
            // disable — the active file would stay loaded — and picking one to
            // delete could throw away a different version. Say so instead and
            // let the file manager resolve it.
            if exists(&current) {
                return Err(SetResourceStateError::FileAlreadyExists);
            }

            // Already in the requested state.
            return Ok(ResourceState {
                resource_type,
                file_name: target,
                enabled,
            });
        }
        if !exists(&current) {
            return Err(SetResourceStateError::FileNotFound);
        }

        let prefix = resource_type.path_prefix();
        server
            .node
            .server_rename_file(
                server.node_server_id,
                format!("{prefix}{current}"),
                format!("{prefix}{target}"),
            )
            .await
            .map_err(|err| match err {
                ServerRenameFileError::Communication(_) => {
                    error!("Failed to request resource rename: {err:?}");
                    SetResourceStateError::NodeFailure
                }
                ServerRenameFileError::StorageMutexLocked => {
                    SetResourceStateError::FileStorageUnavailable
                }
                ServerRenameFileError::FileNotFound => SetResourceStateError::FileNotFound,
                ServerRenameFileError::FileSandboxViolated => {
                    SetResourceStateError::FileSandboxViolated
                }
                ServerRenameFileError::FileAlreadyExists => {
                    SetResourceStateError::FileAlreadyExists
                }
                ServerRenameFileError::AuthInvalid
                | ServerRenameFileError::StorageNotFound
                | ServerRenameFileError::StorageFailure
                | ServerRenameFileError::SqlFailure => {
                    error!("Failed to rename resource: {err:?}");
                    SetResourceStateError::NodeFailure
                }
            })?;

        info!(
            "{} resource {base} on server {server_id}",
            if enabled { "Enabled" } else { "Disabled" }
        );

        Ok(ResourceState {
            resource_type,
            file_name: target,
            enabled,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(file_name: &str, resource_type: ResourceType) -> InstalledResource {
        InstalledResource {
            provider: ResourceProvider::Modrinth,
            project: "abc123".to_owned(),
            version: "v1".to_owned(),
            resource_type,
            file_name: file_name.to_owned(),
            title: file_name.to_owned(),
            enabled: true,
            installed_at: 0,
        }
    }

    /// A readable directory holding `files`.
    fn listing(files: &[&str]) -> Vec<(String, u64)> {
        files
            .iter()
            .map(|file| ((*file).to_owned(), 1024))
            .collect()
    }

    fn names(resources: &[InstalledResource]) -> Vec<&str> {
        resources
            .iter()
            .map(|resource| resource.file_name.as_str())
            .collect()
    }

    #[test]
    fn keeps_records_whose_file_is_still_there() {
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&["a.jar", "b.jar"])))]);

        let (present, missing) = partition_present(
            vec![
                record("a.jar", ResourceType::Plugin),
                record("b.jar", ResourceType::Plugin),
            ],
            &listings,
        );

        assert_eq!(names(&present), ["a.jar", "b.jar"]);
        assert!(missing.is_empty());
    }

    #[test]
    fn drops_records_whose_file_was_removed_externally() {
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&["a.jar"])))]);

        let (present, missing) = partition_present(
            vec![
                record("a.jar", ResourceType::Plugin),
                record("deleted-over-sftp.jar", ResourceType::Plugin),
            ],
            &listings,
        );

        assert_eq!(names(&present), ["a.jar"]);
        assert_eq!(names(&missing), ["deleted-over-sftp.jar"]);
    }

    #[test]
    fn treats_a_renamed_file_as_removed() {
        // A rename cannot be mapped back to a version, so the record is stale
        // and the file becomes an unmanaged plugin.
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&["a-renamed.jar"])))]);

        let (present, missing) =
            partition_present(vec![record("a.jar", ResourceType::Plugin)], &listings);

        assert!(present.is_empty());
        assert_eq!(names(&missing), ["a.jar"]);
    }

    #[test]
    fn a_missing_directory_is_authoritative_and_empty() {
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&[])))]);

        let (present, missing) =
            partition_present(vec![record("a.jar", ResourceType::Plugin)], &listings);

        assert!(present.is_empty());
        assert_eq!(names(&missing), ["a.jar"]);
    }

    #[test]
    fn an_unreadable_directory_never_drops_records() {
        // The safety property: a daemon fault must not be read as removal.
        let listings = HashMap::from([(ResourceType::Plugin, None)]);

        let (present, missing) = partition_present(
            vec![
                record("a.jar", ResourceType::Plugin),
                record("b.jar", ResourceType::Plugin),
            ],
            &listings,
        );

        assert_eq!(names(&present), ["a.jar", "b.jar"]);
        assert!(missing.is_empty());
    }

    #[test]
    fn a_directory_that_was_never_listed_never_drops_records() {
        let (present, missing) =
            partition_present(vec![record("a.jar", ResourceType::Plugin)], &HashMap::new());

        assert_eq!(names(&present), ["a.jar"]);
        assert!(missing.is_empty());
    }

    #[test]
    fn the_disabled_suffix_is_matched_case_insensitively() {
        // `is_resource_file` lowercases, so this has to agree or the record for
        // `Foo.jar` would be judged missing while the file sits right there.
        assert_eq!(split_disabled("Foo.jar.DISABLED"), ("Foo.jar", false));
        assert_eq!(split_disabled("Foo.jar.Disabled"), ("Foo.jar", false));

        let listings =
            HashMap::from([(ResourceType::Plugin, Some(listing(&["Foo.jar.DISABLED"])))]);
        let (present, missing) =
            partition_present(vec![record("Foo.jar", ResourceType::Plugin)], &listings);

        assert!(missing.is_empty());
        assert_eq!(present.first().map(|entry| entry.enabled), Some(false));
        assert!(collect_unmanaged(&listings, &present).is_empty());
    }

    /// Existing cases all use release versions; this keeps them readable.
    fn newest_version_release(versions: Vec<ResourceVersion>) -> Option<ResourceVersion> {
        newest_version(versions, false)
    }

    fn version(id: &str, published_at: Option<&str>) -> ResourceVersion {
        ResourceVersion {
            provider: ResourceProvider::Modrinth,
            id: id.to_owned(),
            project: "proj".to_owned(),
            name: id.to_owned(),
            version_number: id.to_owned(),
            version_type: ResourceVersionType::Release,
            game_versions: vec!["1.21.4".to_owned()],
            loaders: vec!["fabric".to_owned()],
            downloads: 0,
            published_at: published_at.map(str::to_owned),
            file_name: Some(format!("{id}.jar")),
            downloadable: true,
        }
    }

    #[test]
    fn newest_version_uses_the_publish_timestamp_not_list_order() {
        // Deliberately out of order, and mixing the `Z` and `+00:00` spellings
        // that different providers emit.
        let picked = newest_version_release(vec![
            version("old", Some("2026-01-01T00:00:00Z")),
            version("newest", Some("2026-06-01T12:00:00+00:00")),
            version("middle", Some("2026-03-01T00:00:00Z")),
        ]);

        assert_eq!(picked.map(|entry| entry.id), Some("newest".to_owned()));
    }

    #[test]
    fn newest_version_compares_across_timezone_offsets() {
        // 2026-01-01T01:00:00+02:00 is 23:00 the previous day in UTC, so the
        // later-looking string is actually older.
        let picked = newest_version_release(vec![
            version("earlier", Some("2026-01-01T01:00:00+02:00")),
            version("later", Some("2026-01-01T00:30:00Z")),
        ]);

        assert_eq!(picked.map(|entry| entry.id), Some("later".to_owned()));
    }

    #[test]
    fn newest_version_falls_back_to_provider_order_without_timestamps() {
        // Providers list newest first, so the first entry wins when there is
        // nothing to compare.
        let picked = newest_version_release(vec![version("first", None), version("second", None)]);

        assert_eq!(picked.map(|entry| entry.id), Some("first".to_owned()));
    }

    #[test]
    fn newest_version_ignores_unparseable_timestamps() {
        let picked = newest_version_release(vec![
            version("good", Some("2026-01-01T00:00:00Z")),
            version("garbage", Some("not a date")),
        ]);

        assert_eq!(picked.map(|entry| entry.id), Some("good".to_owned()));
    }

    fn prerelease(id: &str, published_at: &str) -> ResourceVersion {
        ResourceVersion {
            version_type: ResourceVersionType::Beta,
            ..version(id, Some(published_at))
        }
    }

    #[test]
    fn a_newer_prerelease_does_not_count_as_an_update_by_default() {
        // "Update all" must not quietly move a live server onto betas.
        let picked = newest_version(
            vec![
                prerelease("beta", "2026-07-01T00:00:00Z"),
                version("stable", Some("2026-06-01T00:00:00Z")),
            ],
            false,
        );

        assert_eq!(picked.map(|entry| entry.id), Some("stable".to_owned()));
    }

    #[test]
    fn a_prerelease_is_offered_when_explicitly_allowed() {
        let picked = newest_version(
            vec![
                prerelease("beta", "2026-07-01T00:00:00Z"),
                version("stable", Some("2026-06-01T00:00:00Z")),
            ],
            true,
        );

        assert_eq!(picked.map(|entry| entry.id), Some("beta".to_owned()));
    }

    #[test]
    fn a_project_with_only_prereleases_can_still_be_updated() {
        let picked = newest_version(
            vec![
                prerelease("older", "2026-01-01T00:00:00Z"),
                prerelease("newer", "2026-07-01T00:00:00Z"),
            ],
            false,
        );

        assert_eq!(picked.map(|entry| entry.id), Some("newer".to_owned()));
    }

    #[test]
    fn newest_version_of_nothing_is_nothing() {
        assert!(newest_version_release(Vec::new()).is_none());
    }

    #[test]
    fn splits_and_rebuilds_the_disabled_suffix() {
        assert_eq!(split_disabled("Foo.jar"), ("Foo.jar", true));
        assert_eq!(split_disabled("Foo.jar.disabled"), ("Foo.jar", false));
        assert_eq!(state_file_name("Foo.jar", true), "Foo.jar");
        assert_eq!(state_file_name("Foo.jar", false), "Foo.jar.disabled");
    }

    #[test]
    fn a_disabled_managed_file_stays_managed_and_reports_disabled() {
        // The whole point: parking a plugin must not read as a removal.
        let listings = HashMap::from([(
            ResourceType::Plugin,
            Some(listing(&["World Events.jar.disabled"])),
        )]);

        let (present, missing) = partition_present(
            vec![record("World Events.jar", ResourceType::Plugin)],
            &listings,
        );

        assert!(missing.is_empty());
        assert_eq!(names(&present), ["World Events.jar"]);
        assert_eq!(present.first().map(|entry| entry.enabled), Some(false));
    }

    #[test]
    fn an_active_managed_file_reports_enabled() {
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&["a.jar"])))]);

        let (present, _missing) =
            partition_present(vec![record("a.jar", ResourceType::Plugin)], &listings);

        assert_eq!(present.first().map(|entry| entry.enabled), Some(true));
    }

    #[test]
    fn a_disabled_managed_file_is_not_also_listed_as_unmanaged() {
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&["a.jar.disabled"])))]);
        let (present, _missing) =
            partition_present(vec![record("a.jar", ResourceType::Plugin)], &listings);

        assert!(collect_unmanaged(&listings, &present).is_empty());
    }

    #[test]
    fn a_disabled_unmanaged_file_reports_its_state() {
        let listings =
            HashMap::from([(ResourceType::Plugin, Some(listing(&["hand.jar.disabled"])))]);

        let unmanaged = collect_unmanaged(&listings, &[]);

        assert_eq!(
            unmanaged
                .iter()
                .map(|entry| (entry.file_name.as_str(), entry.enabled))
                .collect::<Vec<_>>(),
            [("hand.jar.disabled", false)]
        );
    }

    #[test]
    fn state_toggling_only_applies_to_jars() {
        assert!(is_resource_file(ResourceType::Plugin, "a.jar"));
        assert!(is_resource_file(ResourceType::Plugin, "a.jar.disabled"));
        assert!(!is_resource_file(ResourceType::Plugin, "a.zip"));
        assert!(is_resource_file(ResourceType::DataPack, "p.zip"));
    }

    #[test]
    fn reports_files_no_record_claims_as_unmanaged() {
        let listings = HashMap::from([(
            ResourceType::Plugin,
            Some(listing(&["managed.jar", "hand-uploaded.jar"])),
        )]);
        let managed = vec![record("managed.jar", ResourceType::Plugin)];

        let unmanaged = collect_unmanaged(&listings, &managed);

        assert_eq!(
            unmanaged
                .iter()
                .map(|entry| entry.file_name.as_str())
                .collect::<Vec<_>>(),
            ["hand-uploaded.jar"]
        );
        assert_eq!(unmanaged.first().map(|entry| entry.size), Some(1024));
    }

    #[test]
    fn ignores_non_resource_files_and_config_clutter() {
        // A plugin directory is mostly per-plugin data; only jars are resources.
        let listings = HashMap::from([(
            ResourceType::Plugin,
            Some(listing(&[
                "config.yml",
                "latest.log",
                "real.jar",
                "notes.txt",
            ])),
        )]);

        let unmanaged = collect_unmanaged(&listings, &[]);

        assert_eq!(
            unmanaged
                .iter()
                .map(|entry| entry.file_name.as_str())
                .collect::<Vec<_>>(),
            ["real.jar"]
        );
    }

    #[test]
    fn counts_parked_and_odd_case_jars() {
        let listings = HashMap::from([(
            ResourceType::Plugin,
            Some(listing(&["Parked.jar.disabled", "SHOUTY.JAR"])),
        )]);

        assert_eq!(collect_unmanaged(&listings, &[]).len(), 2);
    }

    #[test]
    fn data_packs_are_zips_not_jars() {
        let listings = HashMap::from([(
            ResourceType::DataPack,
            Some(listing(&["pack.zip", "stray.jar"])),
        )]);

        let unmanaged = collect_unmanaged(&listings, &[]);

        assert_eq!(
            unmanaged
                .iter()
                .map(|entry| entry.file_name.as_str())
                .collect::<Vec<_>>(),
            ["pack.zip"]
        );
    }

    #[test]
    fn an_unreadable_directory_reports_no_unmanaged_files() {
        // Nothing is known about it, so claiming it is empty would be a lie.
        let listings = HashMap::from([(ResourceType::Plugin, None)]);

        assert!(collect_unmanaged(&listings, &[]).is_empty());
    }

    #[test]
    fn a_record_dropped_by_reconciliation_does_not_claim_its_file() {
        // The record is gone and so is the file, so neither list mentions it.
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&["kept.jar"])))]);
        let (present, missing) = partition_present(
            vec![
                record("kept.jar", ResourceType::Plugin),
                record("deleted.jar", ResourceType::Plugin),
            ],
            &listings,
        );

        assert_eq!(names(&missing), ["deleted.jar"]);
        assert!(collect_unmanaged(&listings, &present).is_empty());
    }

    #[test]
    fn a_hand_replaced_jar_moves_from_managed_to_unmanaged() {
        // The user swapped Foo-1.0.jar for Foo-2.0.jar over SFTP: the stale
        // record is dropped and the new file surfaces as unmanaged, so the panel
        // still shows exactly what is on disk.
        let listings = HashMap::from([(ResourceType::Plugin, Some(listing(&["Foo-2.0.jar"])))]);
        let (present, missing) =
            partition_present(vec![record("Foo-1.0.jar", ResourceType::Plugin)], &listings);

        assert!(present.is_empty());
        assert_eq!(names(&missing), ["Foo-1.0.jar"]);
        assert_eq!(
            collect_unmanaged(&listings, &present)
                .iter()
                .map(|entry| entry.file_name.as_str())
                .collect::<Vec<_>>(),
            ["Foo-2.0.jar"]
        );
    }

    #[test]
    fn directories_are_reconciled_independently() {
        // Plugins listed fine, mods unreadable: only the plugin record may go.
        let listings = HashMap::from([
            (ResourceType::Plugin, Some(listing(&[]))),
            (ResourceType::Modification, None),
        ]);

        let (present, missing) = partition_present(
            vec![
                record("gone.jar", ResourceType::Plugin),
                record("kept.jar", ResourceType::Modification),
            ],
            &listings,
        );

        assert_eq!(names(&present), ["kept.jar"]);
        assert_eq!(names(&missing), ["gone.jar"]);
    }
}
