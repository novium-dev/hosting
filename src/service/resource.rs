use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;
use crate::db::server::resources::{
    InstalledResource, delete_installed, delete_installed_files, installed_file, list_installed,
    upsert_installed,
};
use crate::resources::{
    MAX_QUERY_LENGTH, MAX_SEARCH_LIMIT, ResourceClient, ResourceError, ResourceLoader,
    ResourceProject, ResourceProvider, ResourceQuery, ResourceType, ResourceVersion,
};
use crate::service::resource::resource_service_error::{
    InstallResourceError, ListInstalledResourcesError, ListResourceVersionsError,
    ResourceContextError, SearchResourcesError, UninstallResourceError,
};
use crate::service::template::*;
use crate::templates::games::minecraft::MinecraftTemplate;
use crate::templates::{Template as _, TemplateError};
use daemon_common::files::FileMode;
use daemon_common::service::files::files_service_error::{
    ServerCreateDirectoryError, ServerDeleteFileError, ServerListFilesError,
    ServerWriteFileByUrlError,
};
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

/// Default page size, matching what the browser shows without scrolling.
const DEFAULT_LIMIT: u8 = 24;

/// Mask selecting the file-type bits out of a Unix mode.
const FILE_TYPE_MASK: u32 = 0xF000;

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
    pub(crate) file_name: String,
    pub(crate) size: u64,
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
            if is_resource_file(*resource_type, name)
                && !claimed.contains(&(*resource_type, name.as_str()))
            {
                unmanaged.push(UnmanagedResource {
                    resource_type: *resource_type,
                    file_name: name.clone(),
                    size: *size,
                });
            }
        }
    }

    unmanaged.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    unmanaged
}

/// Splits records into (still on disk, gone from disk).
///
/// `listings` maps a directory to the file names it holds, or to `None` when it
/// could not be read. An unreadable directory is not evidence of removal, so its
/// records are kept — that is what keeps an unreachable node from wiping the
/// install history. A directory that is missing entirely is readable *and*
/// empty, and belongs in the map as `Some(empty)`.
fn partition_present(
    recorded: Vec<InstalledResource>,
    listings: &HashMap<ResourceType, Listing>,
) -> (Vec<InstalledResource>, Vec<InstalledResource>) {
    recorded.into_iter().partition(|resource| {
        listings
            .get(&resource.resource_type)
            .and_then(Option::as_ref)
            .is_none_or(|files| {
                files
                    .iter()
                    .any(|(name, _size)| *name == resource.file_name)
            })
    })
}

impl Backend {
    fn resource_client(&self) -> ResourceClient<'_> {
        ResourceClient {
            http: &self.http_client,
            cache: self.cache.clone(),
            curseforge_api_key: self.curseforge_api_key.as_deref(),
        }
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
                    .filter(|provider| provider.supports(loader))
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
    #[route("/search", method = GET, query = [ provider, query, loader, game_version, limit, offset ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing})]
    async fn search_resources(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        provider: ResourceProvider,
        query: Option<String>,
        loader: ResourceLoader,
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
                    game_version: game_version.filter(|version| !version.is_empty()),
                    limit: limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_SEARCH_LIMIT),
                    offset: offset.unwrap_or_default(),
                },
            )
            .await
            .map_err(ResourceError::into::<SearchResourcesError>)
    }

    /// Lists the versions of a project that fit `loader`.
    #[route("/versions", method = GET, query = [ provider, project, loader, game_version ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing})]
    async fn list_resource_versions(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        provider: ResourceProvider,
        project: String,
        loader: ResourceLoader,
        game_version: Option<String>,
    ) -> Result<Vec<ResourceVersion>, _> {
        auth.require::<_, _, ListResourceVersionsError>(server_id, ServerPermissions::FILES_READ)?;

        self.resource_client()
            .versions(
                provider,
                &project,
                loader,
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
        if !payload.provider.supports(payload.loader) {
            return Err(InstallResourceError::ResourceInvalidPayload);
        }

        let resource_type = payload.loader.resource_type();
        let resolved = self
            .resource_client()
            .resolve(payload.provider, &payload.project, &payload.version)
            .await
            .map_err(ResourceError::into::<InstallResourceError>)?;

        let previous = installed_file(
            &self.database,
            server_id,
            payload.provider,
            &payload.project,
        )
        .await?;

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
                    InstallResourceError::NodeFailure
                }
                ServerCreateDirectoryError::AuthInvalid
                | ServerCreateDirectoryError::StorageNotFound
                | ServerCreateDirectoryError::StorageFailure
                | ServerCreateDirectoryError::SqlFailure => {
                    error!("Failed to create directory for resource: {err:?}");
                    InstallResourceError::NodeFailure
                }
                ServerCreateDirectoryError::StorageMutexLocked => {
                    InstallResourceError::FileStorageUnavailable
                }
                ServerCreateDirectoryError::FileNotFound => InstallResourceError::FileNotFound,
                ServerCreateDirectoryError::FileSandboxViolated => {
                    InstallResourceError::FileSandboxViolated
                }
                ServerCreateDirectoryError::FileAlreadyExists => {
                    InstallResourceError::FileAlreadyExists
                }
                ServerCreateDirectoryError::StorageQuotaReached => {
                    InstallResourceError::FileQuotaExceeded
                }
            })?;

        let path = format!("{}{}", resource_type.path_prefix(), resolved.file_name);

        server
            .node
            .server_write_file_by_url(server.node_server_id, path, resolved.url)
            .await
            .map_err(|err| match err {
                ServerWriteFileByUrlError::Communication(_) => {
                    error!("Failed to request file upload (by URL) for resource: {err:?}");
                    InstallResourceError::NodeFailure
                }
                ServerWriteFileByUrlError::AuthInvalid
                | ServerWriteFileByUrlError::StorageNotFound
                | ServerWriteFileByUrlError::StorageFailure
                | ServerWriteFileByUrlError::SqlFailure => {
                    error!("Failed to upload file (by URL) for resource: {err:?}");
                    InstallResourceError::NodeFailure
                }
                ServerWriteFileByUrlError::StorageMutexLocked => {
                    InstallResourceError::FileStorageUnavailable
                }
                ServerWriteFileByUrlError::StorageQuotaReached => {
                    InstallResourceError::FileQuotaExceeded
                }
                ServerWriteFileByUrlError::FileNotFound => InstallResourceError::FileNotFound,
                ServerWriteFileByUrlError::FileSandboxViolated => {
                    InstallResourceError::FileSandboxViolated
                }
                ServerWriteFileByUrlError::FileIsDirectory => InstallResourceError::FileIsDirectory,
                ServerWriteFileByUrlError::HttpRequestFailed
                | ServerWriteFileByUrlError::HttpRequestReadFailed
                | ServerWriteFileByUrlError::HttpRequestNotSuccess => {
                    InstallResourceError::ResourceProviderUnavailable
                }
            })?;

        // The replaced jar only needs to go once the new one is on disk. A
        // failure here leaves a stale file behind, which is recoverable through
        // the file manager, so it must not fail the install.
        if let Some((previous_file, previous_type)) = previous
            && previous_file != resolved.file_name
        {
            let previous_path = format!("{}{previous_file}", previous_type.path_prefix());
            if let Err(err) = server
                .node
                .server_delete_file(server.node_server_id, previous_path.clone(), false)
                .await
            {
                warn!("Failed to remove replaced resource {previous_path}: {err:?}");
            }
        }

        let installed = InstalledResource {
            title: payload.title.unwrap_or_else(|| payload.project.clone()),
            provider: payload.provider,
            project: payload.project,
            version: payload.version,
            resource_type,
            file_name: resolved.file_name,
            installed_at: chrono::Utc::now().timestamp(),
        };

        upsert_installed(&self.database, server_id, &installed).await?;

        Ok(installed)
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

        let path = format!("{}{file_name}", resource_type.path_prefix());

        match server
            .node
            .server_delete_file(server.node_server_id, path, false)
            .await
        {
            // Already gone on disk: the record is the thing that is stale, so
            // dropping it below is exactly the right outcome.
            Ok(()) | Err(ServerDeleteFileError::FileNotFound) => {}
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
