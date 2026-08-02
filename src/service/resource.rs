use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::resources::{
    InstalledResource, delete_installed, delete_installed_files, get_modpack, installed_file,
    list_installed, upsert_installed,
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

const DEFAULT_LIMIT: u8 = 24;

const MAX_TITLE_LENGTH: usize = 255;

const FILE_TYPE_MASK: u32 = 0xF000;

const DISABLED_SUFFIX: &str = ".disabled";

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

fn state_file_name(base: &str, enabled: bool) -> String {
    if enabled {
        base.to_owned()
    } else {
        format!("{base}{DISABLED_SUFFIX}")
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceContext {
    pub(crate) loaders: Vec<ResourceLoaderInfo>,
    pub(crate) game_version: Option<String>,
    pub(crate) backup_available: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceLoaderInfo {
    pub(crate) loader: ResourceLoader,
    pub(crate) resource_type: ResourceType,
    pub(crate) providers: Vec<ResourceProvider>,
    pub(crate) modpack_providers: Vec<ResourceProvider>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct InstallResourcePayload {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) loader: ResourceLoader,
    #[serde(default)]
    pub(crate) title: Option<String>,
}

const FEATURE_LOADERS: [(&str, ResourceLoader); 4] = [
    ("minecraft_plugins_paper", ResourceLoader::Paper),
    ("minecraft_mods_fabric", ResourceLoader::Fabric),
    ("minecraft_mods_forge", ResourceLoader::Forge),
    ("minecraft_mods_neoforge", ResourceLoader::Neoforge),
];

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ModpackMod {
    pub(crate) resource_type: ResourceType,
    pub(crate) file_name: String,
    pub(crate) enabled: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstalledModpack {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) title: String,
    pub(crate) installed_at: i64,
    pub(crate) mods: Vec<ModpackMod>,
    pub(crate) other_files: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstalledResources {
    pub(crate) managed: Vec<InstalledResource>,
    pub(crate) modpack: Option<InstalledModpack>,
    pub(crate) unmanaged: Vec<UnmanagedResource>,
    pub(crate) unreadable: Vec<ResourceType>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct UnmanagedResource {
    pub(crate) resource_type: ResourceType,
    pub(crate) file_name: String,
    pub(crate) size: u64,
    pub(crate) enabled: bool,
}

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
    pub(crate) downloadable: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceUpdateResult {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) title: String,
    pub(crate) version: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ResourceState {
    pub(crate) resource_type: ResourceType,
    pub(crate) file_name: String,
    pub(crate) enabled: bool,
}

type Listing = Option<Vec<(String, u64)>>;

const fn is_regular_file(mode: u32) -> bool {
    mode & FILE_TYPE_MASK == FileMode::REG.bits()
}

pub(crate) fn is_resource_file(resource_type: ResourceType, name: &str) -> bool {
    let lower = name.to_lowercase();
    let base = lower.strip_suffix(".disabled").unwrap_or(lower.as_str());
    let extension = Path::new(base).extension().and_then(OsStr::to_str);

    match resource_type {
        ResourceType::Plugin | ResourceType::Modification => extension == Some("jar"),
        ResourceType::DataPack => extension == Some("zip"),
    }
}

pub(crate) fn base_file_name(name: &str) -> String {
    split_disabled(name).0.to_owned()
}

fn split_resource_path(path: &str) -> Option<(ResourceType, &str)> {
    [
        ResourceType::Plugin,
        ResourceType::Modification,
        ResourceType::DataPack,
    ]
    .into_iter()
    .find_map(|resource_type| {
        let name = path.strip_prefix(resource_type.path_prefix())?;
        (!name.is_empty() && !name.contains('/')).then_some((resource_type, name))
    })
}

fn collect_unmanaged(
    listings: &HashMap<ResourceType, Listing>,
    managed: &[InstalledResource],
    pack_files: &HashSet<(ResourceType, String)>,
) -> Vec<UnmanagedResource> {
    let mut claimed: HashSet<(ResourceType, &str)> = managed
        .iter()
        .map(|resource| (resource.resource_type, resource.file_name.as_str()))
        .collect();
    claimed.extend(
        pack_files
            .iter()
            .map(|(resource_type, name)| (*resource_type, name.as_str())),
    );

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
            present.push(resource);
            continue;
        };

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

#[derive(Debug)]
pub(crate) enum InstallError {
    Resource(ResourceError),
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
    pub(crate) fn resource_client(&self) -> ResourceClient<'_> {
        ResourceClient {
            http: &self.http_client,
            cache: self.cache.clone(),
            curseforge_api_key: self.curseforge_api_key.as_deref(),
        }
    }

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
                warn!(
                    "Failed to check updates for {}/{}: {err:?}",
                    resource.provider.as_str(),
                    resource.project
                );
            })
            .ok()?;

        newest_version(versions, allow_prerelease).filter(|latest| latest.id != resource.version)
    }

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

        if let Some((previous_file, previous_type)) = previous
            && previous_file != resolved.file_name
            && let Err(err) = remove_resource_file(server, previous_type, &previous_file).await
        {
            warn!("Failed to remove replaced resource {previous_file}: {err:?}");
        }

        let installed = InstalledResource {
            title: title.map_or_else(
                || project.to_owned(),
                |title| title.chars().take(MAX_TITLE_LENGTH).collect(),
            ),
            provider,
            project: project.to_owned(),
            version: version.to_owned(),
            resource_type,
            file_name: resolved.file_name,
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

        let backup_available = server.backup_limit != Some(0)
            && sqlx::query_scalar!(
                r#"SELECT COUNT(*) AS "count!" FROM node_backup_storage WHERE node = $1"#,
                server.node.id
            )
            .fetch_one(&*self.database)
            .await?
                > 0;

        Ok(ResourceContext {
            loaders,
            backup_available,
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

        let modpack = get_modpack(&self.database, server_id).await?;

        let pack_files: HashSet<(ResourceType, String)> = modpack
            .as_ref()
            .map(|pack| {
                pack.files
                    .iter()
                    .filter_map(|path| split_resource_path(path))
                    .map(|(resource_type, name)| (resource_type, name.to_owned()))
                    .collect()
            })
            .unwrap_or_default();

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ListInstalledResourcesError::ServerNotFound)?;

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
        directories.extend(
            pack_files
                .iter()
                .map(|(resource_type, _name)| *resource_type),
        );

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
            if let Err(err) = delete_installed_files(&self.database, server_id, &files).await {
                warn!("Failed to forget removed resources: {err:?}");
            }
        }

        let modpack = modpack.map(|pack| {
            let mut mods = Vec::new();
            let mut other_files = 0u32;

            for path in &pack.files {
                let Some((resource_type, name)) = split_resource_path(path) else {
                    other_files += 1;
                    continue;
                };
                let Some(files) = listings.get(&resource_type).and_then(Option::as_ref) else {
                    continue;
                };

                for (found, _size) in files {
                    let (base, enabled) = split_disabled(found);
                    if base == name {
                        mods.push(ModpackMod {
                            resource_type,
                            file_name: found.clone(),
                            enabled,
                        });
                    }
                }
            }

            mods.sort_by(|left, right| left.file_name.cmp(&right.file_name));

            InstalledModpack {
                provider: pack.provider,
                project: pack.project,
                version: pack.version,
                title: pack.title,
                installed_at: pack.installed_at,
                mods,
                other_files,
            }
        });

        Ok(InstalledResources {
            unmanaged: collect_unmanaged(&listings, &present, &pack_files),
            managed: present,
            modpack,
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

        if matches!(resource_type, ResourceType::DataPack) {
            return Err(SetResourceStateError::ResourceInvalidPayload);
        }

        let (base, _) = split_disabled(&file);
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
            if exists(&current) {
                return Err(SetResourceStateError::FileAlreadyExists);
            }

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
