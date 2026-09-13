use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::resources::{
    ModpackRecord, delete_installed_files, delete_modpack, get_modpack, upsert_modpack,
};
use crate::db::server::resync::is_running_label;
use crate::db::server::{Server, ServerId};
use crate::resources::modpack::{
    CURSEFORGE_MANIFEST, MODRINTH_INDEX, Modpack, ModpackFile, OVERRIDES_DIR, SERVER_OVERRIDES_DIR,
    parse_curseforge_manifest, parse_modrinth_index, safe_pack_path,
};
use crate::resources::{
    ResourceError, ResourceKind, ResourceLoader, ResourceProvider, ResourceType, ResourceVersion,
    ResourceVersionType, safe_page_url, sanitize_file_name,
};
use crate::service::modpack::modpack_service_error::{
    InstallModpackError, ModpackStatusError, ModpackVersionsError, UnlinkModpackError,
};
use crate::templates::Template as _;
use crate::templates::games::minecraft::MinecraftTemplate;
use crate::utils::FileResponseExtension as _;
use daemon_common::service::backup::backup_service_error::ServerCreateBackupOrderError;
use daemon_common::service::files::files_service_error::{
    ServerCreateDirectoryError, ServerDownloadFileError, ServerListFilesError,
    ServerUnpackArchiveError, ServerWriteFileByUrlError,
};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt as _;
use tracing::{error, info, warn};
use zelus::error::define_error;
use zelus::{define_query_variable, service};

define_query_variable!(allow_prerelease "Whether beta/alpha pack releases count as an update");

define_error!(modpack {
    not_confirmed("Installing a modpack rewrites server files and must be confirmed" BAD_REQUEST),
    already_running("A modpack installation is already running for this server" BAD_REQUEST),
    manifest_missing("The pack archive contains no usable manifest" BAD_GATEWAY),
    backup_unavailable("No backup could be created, so the install was not started" BAD_REQUEST),
    server_running("The server must be stopped before a modpack can be installed" BAD_REQUEST),
});

const STAGING_DIR: &str = ".novium-modpack";

const MAX_MANIFEST_BYTES: u64 = 0x0080_0000;

const MAX_PACK_TITLE: usize = 255;

const MAX_PACK_VERSION_NUMBER: usize = 128;

const CURSEFORGE_FILE_DIR: &str = "mods";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModpackJobState {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ModpackJob {
    pub(crate) state: ModpackJobState,
    pub(crate) step: String,
    pub(crate) done: u32,
    pub(crate) total: u32,
    pub(crate) failures: Vec<String>,
    pub(crate) error: Option<String>,
    pub(crate) pack: Option<String>,
    pub(crate) started_at: i64,
    pub(crate) finished_at: Option<i64>,
}

impl ModpackJob {
    fn new(step: &str) -> Self {
        Self {
            state: ModpackJobState::Running,
            step: step.to_owned(),
            done: 0,
            total: 0,
            failures: Vec::new(),
            error: None,
            pack: None,
            started_at: chrono::Utc::now().timestamp(),
            finished_at: None,
        }
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct InstallModpackPayload {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) loader: ResourceLoader,
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default)]
    pub(crate) version_number: Option<String>,
    #[serde(default)]
    pub(crate) icon_url: Option<String>,
    #[serde(default)]
    pub(crate) page_url: Option<String>,
    #[serde(default)]
    pub(crate) backup: bool,
    #[serde(default)]
    pub(crate) wipe: bool,
    #[serde(default)]
    pub(crate) confirm: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ModpackVersions {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) loader: ResourceLoader,
    pub(crate) title: String,
    pub(crate) installed_version: String,
    pub(crate) latest: Option<ResourceVersion>,
    pub(crate) update_available: bool,
    pub(crate) versions: Vec<ResourceVersion>,
}

impl Backend {
    async fn set_job(&self, server: ServerId, job: ModpackJob) {
        self.modpack_jobs.write().await.insert(server, job);
    }

    async fn update_job(&self, server: ServerId, update: impl FnOnce(&mut ModpackJob)) {
        if let Some(job) = self.modpack_jobs.write().await.get_mut(&server) {
            update(job);
        }
    }

    async fn fail_job(&self, server: ServerId, reason: &str) {
        error!("Modpack install failed on server {server}: {reason}");
        self.update_job(server, |job| {
            job.state = ModpackJobState::Failed;
            job.error = Some(reason.to_owned());
            job.finished_at = Some(chrono::Utc::now().timestamp());
        })
        .await;
    }

    async fn read_server_file(
        &self,
        server: &Server,
        path: String,
    ) -> Result<Vec<u8>, ServerDownloadFileError> {
        let data = server
            .node
            .server_download_file(server.node_server_id, path, Some(MAX_MANIFEST_BYTES))
            .await?
            .into_data_stream()
            .ok_or(ServerDownloadFileError::StorageFailure)?;

        let mut buffer = Vec::new();
        let mut reader = data.reader();
        reader
            .read_to_end(&mut buffer)
            .await
            .map_err(ServerDownloadFileError::from)?;

        Ok(buffer)
    }

    async fn wipe_mods(&self, server: &Server) -> Result<u32, ServerListFilesError> {
        let entries = match server
            .node
            .server_list_files(
                server.node_server_id,
                ResourceType::Modification.directory(),
            )
            .await
        {
            Ok(entries) => entries,
            Err(ServerListFilesError::FileNotFound) => return Ok(0),
            Err(err) => return Err(err),
        };

        let mut removed = Vec::new();
        for entry in entries {
            if !super::resource::is_resource_file(ResourceType::Modification, &entry.name) {
                continue;
            }

            let path = format!("{}{}", ResourceType::Modification.path_prefix(), entry.name);
            match server
                .node
                .server_delete_file(server.node_server_id, path.clone(), false)
                .await
            {
                Ok(()) => removed.push(entry.name),
                Err(err) => warn!("Failed to remove {path} while wiping mods: {err:?}"),
            }
        }

        let bases: Vec<String> = removed
            .iter()
            .map(|name| super::resource::base_file_name(name))
            .collect();
        if !bases.is_empty()
            && let Err(err) = delete_installed_files(&self.database, server.id, &bases).await
        {
            warn!("Failed to forget wiped mod records: {err:?}");
        }

        Ok(u32::try_from(removed.len()).unwrap_or(u32::MAX))
    }

    async fn apply_overrides(&self, server: &Server, root: &str) -> u32 {
        let mut queue = vec![String::new()];
        let mut copied = 0u32;

        while let Some(relative) = queue.pop() {
            let source_dir = if relative.is_empty() {
                root.to_owned()
            } else {
                format!("{root}/{relative}")
            };

            let entries = match server
                .node
                .server_list_files(server.node_server_id, source_dir.clone())
                .await
            {
                Ok(entries) => entries,
                Err(ServerListFilesError::FileNotFound) => continue,
                Err(err) => {
                    warn!("Failed to list overrides at {source_dir}: {err:?}");
                    continue;
                }
            };

            for entry in entries {
                let Some(name) = safe_pack_path(&entry.name) else {
                    warn!(
                        "Skipping override entry with an unusable name: {}",
                        entry.name
                    );
                    continue;
                };
                let child = if relative.is_empty() {
                    name.clone()
                } else {
                    format!("{relative}/{name}")
                };
                let from = format!("{source_dir}/{}", entry.name);

                if entry.mode & 0xF000 == 0x4000 {
                    if let Err(err) = server
                        .node
                        .server_create_directory(server.node_server_id, child.clone(), true)
                        .await
                        && !matches!(err, ServerCreateDirectoryError::FileAlreadyExists)
                    {
                        warn!("Failed to create override directory {child}: {err:?}");
                        continue;
                    }
                    queue.push(child);
                } else {
                    match server
                        .node
                        .server_copy_file(server.node_server_id, from.clone(), child.clone())
                        .await
                    {
                        Ok(()) => copied += 1,
                        Err(err) => warn!("Failed to copy override {from} -> {child}: {err:?}"),
                    }
                }
            }
        }

        copied
    }

    async fn resolve_curseforge_files(&self, files: Vec<ModpackFile>) -> Vec<ModpackFile> {
        let mut resolved = Vec::with_capacity(files.len());

        for file in files {
            let Some((project, version)) = file.curseforge.clone() else {
                resolved.push(file);
                continue;
            };

            match self
                .resource_client()
                .resolve(ResourceProvider::Curseforge, &project, &version)
                .await
            {
                Ok(entry) => resolved.push(ModpackFile {
                    path: format!("{CURSEFORGE_FILE_DIR}/{}", entry.file_name),
                    url: Some(entry.url.to_string()),
                    curseforge: None,
                }),
                Err(err) => {
                    warn!("Failed to resolve CurseForge pack file {project}/{version}: {err:?}");
                    resolved.push(ModpackFile {
                        path: format!("curseforge:{project}"),
                        url: None,
                        curseforge: None,
                    });
                }
            }
        }

        resolved
    }

    async fn read_pack_manifest(
        &self,
        server: &Server,
        extracted: &str,
    ) -> Result<Modpack, ResourceError> {
        let modrinth = self
            .read_server_file(server, format!("{extracted}/{MODRINTH_INDEX}"))
            .await;
        if let Ok(raw) = modrinth {
            return parse_modrinth_index(&raw);
        }

        let curseforge = self
            .read_server_file(server, format!("{extracted}/{CURSEFORGE_MANIFEST}"))
            .await
            .map_err(|err| {
                warn!("Neither pack manifest could be read: {err:?}");
                ResourceError::Missing
            })?;
        parse_curseforge_manifest(&curseforge)
    }

    async fn run_modpack_install(
        &self,
        server: Server,
        payload: InstallModpackPayload,
        pack_file: String,
        pack_url: url::Url,
    ) {
        let server_id = server.id;
        let staging = STAGING_DIR.to_owned();
        let archive = format!("{staging}/{pack_file}");
        let extracted = format!("{staging}/extracted");

        if payload.backup {
            self.update_job(server_id, |job| {
                "Creating backup".clone_into(&mut job.step);
            })
            .await;

            if let Err(err) = server
                .node
                .server_create_backup_order(server.node_server_id, None)
                .await
            {
                let reason = match err {
                    ServerCreateBackupOrderError::BackupStorageNoSuitableFound => {
                        "No backup storage is available on this node"
                    }
                    _ => "The backup could not be created",
                };
                error!("Modpack backup failed for {server_id}: {err:?}");
                self.fail_job(server_id, reason).await;
                return;
            }
        }

        self.update_job(server_id, |job| {
            "Downloading pack".clone_into(&mut job.step);
        })
        .await;

        if let Err(err) = server
            .node
            .server_create_directory(server.node_server_id, staging.clone(), true)
            .await
            && !matches!(err, ServerCreateDirectoryError::FileAlreadyExists)
        {
            error!("Failed to create modpack staging directory: {err:?}");
            self.fail_job(server_id, "The staging directory could not be created")
                .await;
            return;
        }

        if let Err(err) = server
            .node
            .server_write_file_by_url(server.node_server_id, archive.clone(), pack_url)
            .await
        {
            error!("Failed to download modpack archive: {err:?}");
            let reason = match err {
                ServerWriteFileByUrlError::StorageQuotaReached => {
                    "The pack does not fit in the server's storage quota"
                }
                _ => "The pack archive could not be downloaded",
            };
            self.fail_job(server_id, reason).await;
            self.cleanup_staging(&server, &staging).await;
            return;
        }

        self.update_job(server_id, |job| {
            "Unpacking".clone_into(&mut job.step);
        })
        .await;

        if let Err(err) = server
            .node
            .server_unpack_archive(server.node_server_id, archive.clone(), extracted.clone())
            .await
        {
            error!("Failed to unpack modpack archive: {err:?}");
            let reason = match err {
                ServerUnpackArchiveError::CompressionUnsupported => {
                    "The pack archive format is not supported"
                }
                ServerUnpackArchiveError::StorageQuotaReached => {
                    "Unpacking the pack would exceed the storage quota"
                }
                _ => "The pack archive could not be unpacked",
            };
            self.fail_job(server_id, reason).await;
            self.cleanup_staging(&server, &staging).await;
            return;
        }

        self.update_job(server_id, |job| {
            "Reading manifest".clone_into(&mut job.step);
        })
        .await;

        let pack = match self.read_pack_manifest(&server, &extracted).await {
            Ok(pack) => pack,
            Err(err) => {
                error!("Failed to read modpack manifest: {err:?}");
                self.fail_job(server_id, "The pack contains no usable manifest")
                    .await;
                self.cleanup_staging(&server, &staging).await;
                return;
            }
        };

        let pack_name = pack.name.clone();
        let files = self.resolve_curseforge_files(pack.files.clone()).await;
        let total = u32::try_from(files.len()).unwrap_or(u32::MAX);
        self.update_job(server_id, |job| {
            "Installing mods".clone_into(&mut job.step);
            job.total = total;
            job.pack = pack_name;
        })
        .await;

        if payload.wipe {
            self.update_job(server_id, |job| {
                "Clearing existing mods".clone_into(&mut job.step);
            })
            .await;

            if let Err(err) = delete_modpack(&self.database, server_id).await {
                warn!("Failed to clear the previous modpack record: {err:?}");
            }

            match self.wipe_mods(&server).await {
                Ok(removed) => info!("Cleared {removed} mod(s) before installing a pack"),
                Err(err) => {
                    error!("Failed to clear mods before a pack install: {err:?}");
                    self.fail_job(server_id, "The existing mods could not be cleared")
                        .await;
                    self.cleanup_staging(&server, &staging).await;
                    return;
                }
            }

            self.update_job(server_id, |job| {
                "Installing mods".clone_into(&mut job.step);
            })
            .await;
        }

        let mut installed_paths = Vec::new();

        for file in files {
            let Some(url) = file.url.as_deref().and_then(|url| url.parse().ok()) else {
                self.update_job(server_id, |job| {
                    job.failures.push(file.path.clone());
                    job.done += 1;
                })
                .await;
                continue;
            };

            if let Some((parent, _)) = file.path.rsplit_once('/')
                && let Err(err) = server
                    .node
                    .server_create_directory(server.node_server_id, parent.to_owned(), true)
                    .await
                && !matches!(err, ServerCreateDirectoryError::FileAlreadyExists)
            {
                warn!("Failed to create {parent} for a pack file: {err:?}");
            }

            let outcome = server
                .node
                .server_write_file_by_url(server.node_server_id, file.path.clone(), url)
                .await;

            match &outcome {
                Ok(()) => installed_paths.push(file.path.clone()),
                Err(err) => warn!("Failed to install pack file {}: {err:?}", file.path),
            }

            self.update_job(server_id, |job| {
                if outcome.is_err() {
                    job.failures.push(file.path.clone());
                }
                job.done += 1;
            })
            .await;
        }

        self.update_job(server_id, |job| {
            "Applying pack configuration".clone_into(&mut job.step);
        })
        .await;

        let mut copied = self
            .apply_overrides(&server, &format!("{extracted}/{OVERRIDES_DIR}"))
            .await;
        copied += self
            .apply_overrides(&server, &format!("{extracted}/{SERVER_OVERRIDES_DIR}"))
            .await;
        info!("Applied {copied} override file(s) for a pack on {server_id}");

        let record = ModpackRecord {
            provider: payload.provider,
            project: payload.project.clone(),
            version: payload.version.clone(),
            version_number: payload
                .version_number
                .clone()
                .or_else(|| pack.version.clone())
                .map(|number| number.chars().take(MAX_PACK_VERSION_NUMBER).collect()),
            loader: Some(payload.loader),
            title: payload
                .title
                .clone()
                .or_else(|| pack.name.clone())
                .unwrap_or_else(|| payload.project.clone())
                .chars()
                .take(MAX_PACK_TITLE)
                .collect(),
            icon_url: safe_page_url(payload.icon_url.clone()),
            page_url: safe_page_url(payload.page_url.clone()),
            files: installed_paths,
            installed_at: chrono::Utc::now().timestamp(),
        };
        if let Err(err) = upsert_modpack(&self.database, server_id, &record).await {
            error!("Failed to record the installed modpack: {err:?}");
        }

        self.cleanup_staging(&server, &staging).await;

        self.update_job(server_id, |job| {
            job.state = ModpackJobState::Completed;
            "Done".clone_into(&mut job.step);
            job.finished_at = Some(chrono::Utc::now().timestamp());
        })
        .await;
    }

    async fn cleanup_staging(&self, server: &Server, staging: &str) {
        if let Err(err) = server
            .node
            .server_delete_file(server.node_server_id, staging.to_owned(), true)
            .await
        {
            warn!("Failed to clean up modpack staging directory: {err:?}");
        }
    }
}

#[service(path = "/modpack/{server_id}", tag = "modpack", no_sdk)]
pub(crate) impl ModpackService for Backend {
    /// Progress of this server's modpack install, if one has run.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_READ`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn modpack_status(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Option<ModpackJob>, _> {
        auth.require::<_, _, ModpackStatusError>(server_id, ServerPermissions::FILES_READ)?;

        Ok(self.modpack_jobs.read().await.get(&server_id).cloned())
    }

    /// Installs a modpack in the background.
    ///
    /// This rewrites files on a live server, so `confirm` is mandatory. With
    /// `backup` the server is backed up first and the install is abandoned if
    /// that fails; with `wipe` the existing mod jars are cleared so the result
    /// matches the pack author's intent, and without it the pack is merged into
    /// what is already installed.
    ///
    /// Returns as soon as the job is accepted — a pack is one large archive plus
    /// hundreds of downloads, so progress is polled from `GET /modpack/{id}`.
    /// The server has to be stopped: the install rewrites the mod jars and the
    /// pack's configuration underneath a running process.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_WRITE`].
    #[route("/install", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing, wrong_template}, modpack::{not_confirmed, already_running, server_running})]
    async fn install_modpack(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        payload: InstallModpackPayload,
    ) -> Result<ModpackJob, _> {
        auth.require::<_, _, InstallModpackError>(server_id, ServerPermissions::FILES_WRITE)?;

        if !payload.confirm {
            return Err(InstallModpackError::ModpackNotConfirmed);
        }
        if !payload
            .provider
            .supports(payload.loader, ResourceKind::Modpack)
        {
            return Err(InstallModpackError::ResourceInvalidPayload);
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(InstallModpackError::ServerNotFound)?;

        if server.template.id() != MinecraftTemplate::ID {
            return Err(InstallModpackError::ResourceWrongTemplate);
        }

        if server
            .node
            .server_status(server.node_server_id)
            .await
            .is_ok_and(|status| is_running_label(&status.state.label))
        {
            return Err(InstallModpackError::ModpackServerRunning);
        }

        if self
            .modpack_jobs
            .read()
            .await
            .get(&server_id)
            .is_some_and(|job| job.state == ModpackJobState::Running)
        {
            return Err(InstallModpackError::ModpackAlreadyRunning);
        }

        let resolved = self
            .resource_client()
            .resolve(payload.provider, &payload.project, &payload.version)
            .await
            .map_err(ResourceError::into::<InstallModpackError>)?;

        let pack_file = sanitize_file_name(&resolved.file_name, "modpack.zip");
        let job = ModpackJob::new("Queued");
        self.set_job(server_id, job.clone()).await;

        let backend = self.clone();
        let url = resolved.url;
        self.server_task_cancellable.lock().await.spawn(async move {
            backend
                .run_modpack_install(server, payload, pack_file, url)
                .await;
        });

        Ok(job)
    }

    /// Forgets the modpack this server is linked to.
    ///
    /// Only the link is dropped — the pack's mods and configuration stay on
    /// disk, so the server keeps running exactly as it did. Its jars stop being
    /// reported as pack contents and show up as hand-uploaded files instead.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_WRITE`].
    #[route("", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn unlink_modpack(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        auth.require::<_, _, UnlinkModpackError>(server_id, ServerPermissions::FILES_WRITE)?;

        delete_modpack(&self.database, server_id).await?;

        Ok(())
    }

    /// Lists the versions of the modpack this server is linked to.
    ///
    /// The link is what makes an installed pack updatable: the record carries
    /// the provider, project and loader the pack came from, so the same call
    /// answers both "which versions can I switch to" and "is there a newer
    /// one". `latest` is the newest version the pack offers, and
    /// `update_available` says whether it differs from the installed one;
    /// beta/alpha releases only count when `allow_prerelease` is set. Returns
    /// `null` when no pack is linked, or when the link predates the stored
    /// loader and cannot be resolved upstream.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_READ`].
    #[route("/versions", method = GET, query = [ allow_prerelease ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing})]
    async fn modpack_versions(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        allow_prerelease: Option<bool>,
    ) -> Result<Option<ModpackVersions>, _> {
        auth.require::<_, _, ModpackVersionsError>(server_id, ServerPermissions::FILES_READ)?;

        let Some(pack) = get_modpack(&self.database, server_id).await? else {
            return Ok(None);
        };
        let Some(loader) = pack.loader else {
            return Ok(None);
        };

        let versions = self
            .resource_client()
            .versions(
                pack.provider,
                &pack.project,
                loader,
                ResourceKind::Modpack,
                None,
            )
            .await
            .map_err(ResourceError::into::<ModpackVersionsError>)?;

        let latest = versions
            .iter()
            .find(|version| {
                allow_prerelease.unwrap_or_default()
                    || version.version_type == ResourceVersionType::Release
            })
            .cloned();

        Ok(Some(ModpackVersions {
            provider: pack.provider,
            project: pack.project,
            loader,
            title: pack.title,
            update_available: latest
                .as_ref()
                .is_some_and(|version| version.id != pack.version),
            installed_version: pack.version,
            latest,
            versions,
        }))
    }
}
