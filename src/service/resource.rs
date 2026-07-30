use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;
use crate::db::server::resources::{
    InstalledResource, delete_installed, installed_file, list_installed, upsert_installed,
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
use daemon_common::service::files::files_service_error::{
    ServerCreateDirectoryError, ServerDeleteFileError, ServerWriteFileByUrlError,
};
use serde::{Deserialize, Serialize};
use tracing::{error, warn};
use zelus::service;

define_query_variable!(provider "The resource provider");
define_query_variable!(query "The search query");
define_query_variable!(loader "The mod/plugin loader to search for");
define_query_variable!(game_version "Restrict results to this Minecraft version");
define_query_variable!(project "The provider-scoped project id");
define_query_variable!(offset "The number of results to skip");

/// Default page size, matching what the browser shows without scrolling.
const DEFAULT_LIMIT: u8 = 24;

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

    /// Lists what is installed on this server.
    ///
    /// Backed by the `server_resources` table rather than by scanning
    /// `mods/`/`plugins/`, so a client learns the installed set (and which
    /// exact version it is) in one request.
    #[route("/installed", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn list_installed_resources(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Vec<InstalledResource>, _> {
        auth.require::<_, _, ListInstalledResourcesError>(
            server_id,
            ServerPermissions::FILES_READ,
        )?;

        Ok(list_installed(&self.database, server_id).await?)
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
