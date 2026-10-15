use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::cluster::{JOB_LOCK_TTL, JOB_RETENTION};
use crate::db::server::resources::{
    ModpackFileRecord, ModpackRecord, delete_installed_files, delete_modpack, get_modpack,
    list_installed, replace_modpack,
};
use crate::db::server::resync::is_running_label;
use crate::db::server::{Server, ServerId};
use crate::resources::modpack::{
    CURSEFORGE_MANIFEST, MODRINTH_INDEX, Modpack, ModpackFile, OVERRIDES_DIR, PackLoader,
    PackPlatform, PackSource, SERVER_OVERRIDES_DIR, parse_curseforge_manifest,
    parse_modrinth_index, safe_pack_path,
};
use crate::resources::{
    ProjectDetails, ResourceError, ResourceKind, ResourceLoader, ResourceProvider, ResourceType,
    ResourceVersion, ResourceVersionType, safe_page_url, sanitize_file_name,
};
use crate::service::modpack::modpack_service_error::{
    InstallModpackError, ModpackStatusError, ModpackVersionsError, UnlinkModpackError,
};
use crate::service::server::BuildPushError;
use crate::templates::Template as _;
use crate::templates::games::minecraft::{
    MinecraftServerExtra, MinecraftServerModification, MinecraftTemplate,
};
use crate::utils::FileResponseExtension as _;
use daemon_common::service::backup::backup_service_error::ServerCreateBackupOrderError;
use daemon_common::service::files::files_service_error::{
    ServerCreateDirectoryError, ServerDeleteFileError, ServerDownloadFileError,
    ServerListFilesError, ServerUnpackArchiveError, ServerWriteFileByUrlError,
};
use futures::StreamExt as _;
use futures::stream::FuturesUnordered;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tokio::io::AsyncReadExt as _;
use tracing::{error, info, warn};
use zelus::{define_query_variable, service};

define_query_variable!(allow_prerelease "Whether beta/alpha pack releases count as an update");

const STAGING_DIR: &str = ".novium-modpack";

const MAX_MANIFEST_BYTES: u64 = 0x0080_0000;

const MAX_PACK_TITLE: usize = 255;

const MAX_PACK_VERSION_NUMBER: usize = 128;

const MAX_REPORTED_PATHS: usize = 50;

const CURSEFORGE_FILE_DIR: &str = "mods";

const DOWNLOAD_ATTEMPTS: u32 = 3;

const PARALLEL_DOWNLOADS: usize = 6;

const DISABLED_SUFFIX: &str = ".disabled";

const FILE_TYPE_MASK: u32 = 0xF000;

const DIRECTORY_MODE: u32 = 0x4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModpackJobState {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModpackStep {
    Queued,
    Downloading,
    Unpacking,
    Reading,
    Resolving,
    Fetching,
    BackingUp,
    Platform,
    Applying,
    Configuring,
    Finishing,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct ModpackJob {
    pub(crate) state: ModpackJobState,
    pub(crate) step: ModpackStep,
    pub(crate) done: u32,
    pub(crate) total: u32,
    pub(crate) failures: Vec<String>,
    pub(crate) skipped: Vec<String>,
    pub(crate) error: Option<String>,
    pub(crate) pack: Option<String>,
    pub(crate) platform: Option<PackPlatform>,
    pub(crate) live_untouched: bool,
    pub(crate) started_at: i64,
    pub(crate) finished_at: Option<i64>,
}

impl ModpackJob {
    fn new(pack: Option<String>) -> Self {
        Self {
            state: ModpackJobState::Running,
            step: ModpackStep::Queued,
            done: 0,
            total: 0,
            failures: Vec::new(),
            skipped: Vec::new(),
            error: None,
            pack,
            platform: None,
            live_untouched: true,
            started_at: chrono::Utc::now().timestamp(),
            finished_at: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModpackInstallMode {
    #[default]
    Keep,
    Reset,
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
    pub(crate) mode: ModpackInstallMode,
    #[serde(default)]
    pub(crate) sync_platform: bool,
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

pub(crate) fn job_lock(server: ServerId) -> String {
    format!("modpack:lock:{server}")
}

fn job_key(server: ServerId) -> String {
    format!("modpack:job:{server}")
}

fn staged_path(path: &str) -> String {
    format!("{STAGING_DIR}/files/{path}")
}

fn extracted_dir() -> String {
    format!("{STAGING_DIR}/extracted")
}

fn disabled_name(path: &str) -> String {
    format!("{path}{DISABLED_SUFFIX}")
}

fn parent_dir(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _name)| parent)
}

fn report(paths: &[String]) -> String {
    let mut listed: Vec<&str> = paths
        .iter()
        .take(MAX_REPORTED_PATHS)
        .map(String::as_str)
        .collect();
    if paths.len() > MAX_REPORTED_PATHS {
        listed.push("...");
    }
    listed.join(", ")
}

struct PlatformPlan {
    target: PackPlatform,
    new_extra: Option<serde_json::Value>,
}

const fn software_for(loader: PackLoader) -> Option<MinecraftServerModification> {
    match loader {
        PackLoader::Fabric => Some(MinecraftServerModification::Fabric),
        PackLoader::Quilt => Some(MinecraftServerModification::Quilt),
        PackLoader::Neoforge => Some(MinecraftServerModification::NeoForge),
        PackLoader::Forge => None,
    }
}

fn describe(software: MinecraftServerModification, game: &str, build: Option<&str>) -> String {
    build.map_or_else(
        || format!("{software} {game}"),
        |build| format!("{software} {build} on Minecraft {game}"),
    )
}

#[derive(Debug)]
enum InstallFailure {
    Reason(String),
    Quota,
}

impl From<&str> for InstallFailure {
    fn from(value: &str) -> Self {
        Self::Reason(value.to_owned())
    }
}

impl From<String> for InstallFailure {
    fn from(value: String) -> Self {
        Self::Reason(value)
    }
}

impl InstallFailure {
    fn reason(self) -> String {
        match self {
            Self::Reason(reason) => reason,
            Self::Quota => "The pack does not fit in the server's storage quota".to_owned(),
        }
    }
}

impl Backend {
    async fn set_job(&self, server: ServerId, job: ModpackJob) {
        self.store_shared(&job_key(server), &job, JOB_RETENTION)
            .await;
        self.modpack_jobs.write().await.insert(server, job);
    }

    async fn update_job(&self, server: ServerId, update: impl FnOnce(&mut ModpackJob)) {
        let mut jobs = self.modpack_jobs.write().await;
        if let Some(job) = jobs.get_mut(&server) {
            update(job);
            self.store_shared(&job_key(server), &*job, JOB_RETENTION)
                .await;
        }
    }

    async fn set_step(&self, server: ServerId, step: ModpackStep) {
        self.update_job(server, |job| job.step = step).await;
    }

    async fn modpack_job(&self, server: ServerId) -> Result<Option<ModpackJob>, redis::RedisError> {
        let Some(mut job) = self.load_shared::<ModpackJob>(&job_key(server)).await? else {
            return Ok(None);
        };

        if job.state == ModpackJobState::Running && !self.is_locked(&job_lock(server)).await {
            job.state = ModpackJobState::Failed;
            job.error = Some("The instance running the install stopped".to_owned());
        }

        Ok(Some(job))
    }

    pub(crate) async fn modpack_installing(&self, server: ServerId) -> bool {
        self.is_locked(&job_lock(server)).await
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

    async fn ensure_dir(&self, server: &Server, path: &str) -> Result<(), InstallFailure> {
        match server
            .node
            .server_create_directory(server.node_server_id, path.to_owned(), true)
            .await
        {
            Ok(()) | Err(ServerCreateDirectoryError::FileAlreadyExists) => Ok(()),
            Err(ServerCreateDirectoryError::StorageQuotaReached) => Err(InstallFailure::Quota),
            Err(err) => {
                warn!("Failed to create {path} for a modpack: {err:?}");
                Err(InstallFailure::from(format!(
                    "The directory {path} could not be created"
                )))
            }
        }
    }

    async fn remove_path(&self, server: &Server, path: &str, recursive: bool) -> bool {
        match server
            .node
            .server_delete_file(server.node_server_id, path.to_owned(), recursive)
            .await
        {
            Ok(()) | Err(ServerDeleteFileError::FileNotFound) => true,
            Err(err) => {
                warn!("Failed to remove {path} during a modpack install: {err:?}");
                false
            }
        }
    }

    async fn list_names(&self, server: &Server, dir: &str) -> Option<HashSet<String>> {
        match server
            .node
            .server_list_files(server.node_server_id, dir.to_owned())
            .await
        {
            Ok(entries) => Some(entries.into_iter().map(|entry| entry.name).collect()),
            Err(ServerListFilesError::FileNotFound) => Some(HashSet::new()),
            Err(err) => {
                warn!("Failed to list {dir} during a modpack install: {err:?}");
                None
            }
        }
    }

    async fn apply_overrides(&self, server: &Server, root: &str) -> (u32, Vec<String>) {
        let mut queue = vec![String::new()];
        let mut copied = 0u32;
        let mut failed = Vec::new();

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
                    failed.push(relative.clone());
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

                if entry.mode & FILE_TYPE_MASK == DIRECTORY_MODE {
                    if self.ensure_dir(server, &child).await.is_err() {
                        failed.push(child);
                        continue;
                    }
                    queue.push(child);
                } else {
                    match server
                        .node
                        .server_copy_file(server.node_server_id, from.clone(), child.clone())
                        .await
                    {
                        Ok(()) => copied = copied.saturating_add(1),
                        Err(err) => {
                            warn!("Failed to copy override {from} -> {child}: {err:?}");
                            failed.push(child);
                        }
                    }
                }
            }
        }

        (copied, failed)
    }

    async fn resolve_curseforge_files(
        &self,
        files: Vec<ModpackFile>,
        identities: &mut HashMap<String, (String, String)>,
        skipped: &mut Vec<String>,
    ) -> Result<Vec<ModpackFile>, InstallFailure> {
        let mut resolved = Vec::with_capacity(files.len());
        let mut unresolved = Vec::new();

        for file in files {
            let PackSource::Curseforge {
                project,
                file: version,
            } = &file.source
            else {
                resolved.push(file);
                continue;
            };

            match self
                .resource_client()
                .resolve(ResourceProvider::Curseforge, project, version)
                .await
            {
                Ok(entry) => {
                    let path = format!("{CURSEFORGE_FILE_DIR}/{}", entry.file_name);
                    identities.insert(path.clone(), (project.clone(), version.clone()));
                    resolved.push(ModpackFile {
                        path,
                        source: PackSource::Url(entry.url),
                        size: None,
                        sha1: None,
                    });
                }
                Err(ResourceError::DownloadUnavailable) => {
                    skipped.push(format!("CurseForge project {project}"));
                }
                Err(err) => {
                    warn!("Failed to resolve CurseForge pack file {project}/{version}: {err:?}");
                    unresolved.push(format!("CurseForge project {project}"));
                }
            }
        }

        if unresolved.is_empty() {
            Ok(resolved)
        } else {
            Err(InstallFailure::from(format!(
                "CurseForge could not resolve {} pack file(s): {}",
                unresolved.len(),
                report(&unresolved)
            )))
        }
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

    async fn plan_platform(
        &self,
        server: &Server,
        target: PackPlatform,
        sync: bool,
    ) -> Result<PlatformPlan, InstallFailure> {
        let current: MinecraftServerExtra = serde_json::from_value(server.template_extra.clone())
            .map_err(|err| {
            error!("Failed to read the server's Minecraft settings: {err:?}");
            InstallFailure::from("The server's Minecraft settings could not be read")
        })?;

        let Some(loader) = target.loader else {
            return Ok(PlatformPlan {
                target,
                new_extra: None,
            });
        };
        let Some(software) = software_for(loader) else {
            return Err(InstallFailure::from(format!(
                "This pack needs {}, which this server cannot run",
                loader.label()
            )));
        };

        let current_software = current.modification();
        let current_game = current.minecraft_version();
        let current_build = current.mod_build();
        let game = target
            .game_version
            .clone()
            .unwrap_or_else(|| current_game.clone());

        let software_differs = current_software != software || current_game != game;
        let build_differs = target
            .loader_version
            .as_ref()
            .is_some_and(|build| current_build.as_ref() != Some(build));

        if !software_differs && !build_differs {
            return Ok(PlatformPlan {
                target,
                new_extra: None,
            });
        }

        if !sync {
            if software_differs {
                return Err(InstallFailure::from(format!(
                    "This pack needs {}, but the server runs {}. Allow the install to switch the platform, or change it in the build settings first",
                    describe(software, &game, target.loader_version.as_deref()),
                    describe(current_software, &current_game, current_build.as_deref())
                )));
            }
            warn!(
                "Pack wants loader {:?} but server {} keeps {current_build:?}",
                target.loader_version, server.id
            );
            return Ok(PlatformPlan {
                target,
                new_extra: None,
            });
        }

        let build = target
            .loader_version
            .clone()
            .or_else(|| (!software_differs).then(|| current_build.clone()).flatten())
            .ok_or_else(|| {
                InstallFailure::from(format!(
                    "The pack does not say which {} version it needs",
                    loader.label()
                ))
            })?;

        let java = if current.java_pinned() == Some(true) && current_game == game {
            format!("Java {}", current.java())
        } else {
            "Recommended".to_owned()
        };

        let variables = HashMap::from([
            ("software".to_owned(), software.to_string()),
            ("minecraft_version".to_owned(), game.clone()),
            ("mod_build".to_owned(), build.clone()),
            ("java".to_owned(), java),
        ]);

        let new_extra = server
            .template
            .variables_to_extra_validated(
                self.cache.clone(),
                server.template_extra.clone(),
                variables,
            )
            .await
            .map_err(|err| {
                error!("Failed to validate the pack's platform: {err:?}");
                InstallFailure::from("The pack's platform could not be checked")
            })?
            .ok_or_else(|| {
                InstallFailure::from(format!(
                    "{} is not available on this panel",
                    describe(software, &game, Some(&build))
                ))
            })?;

        Ok(PlatformPlan {
            target: PackPlatform {
                game_version: Some(game),
                loader: Some(loader),
                loader_version: Some(build),
            },
            new_extra: Some(new_extra),
        })
    }

    async fn stage_file(&self, server: &Server, file: &ModpackFile) -> Result<(), InstallFailure> {
        let PackSource::Url(url) = &file.source else {
            return Err(InstallFailure::from("unresolved"));
        };
        let target = staged_path(&file.path);
        if let Some(parent) = parent_dir(&target) {
            self.ensure_dir(server, parent).await?;
        }

        let mut last = InstallFailure::from("download failed");
        for attempt in 1..=DOWNLOAD_ATTEMPTS {
            match server
                .node
                .server_write_file_by_url(server.node_server_id, target.clone(), url.clone())
                .await
            {
                Ok(()) => {}
                Err(ServerWriteFileByUrlError::StorageQuotaReached) => {
                    return Err(InstallFailure::Quota);
                }
                Err(err) => {
                    warn!(
                        "Attempt {attempt} to download {} failed: {err:?}",
                        file.path
                    );
                    last = InstallFailure::from("download failed");
                    continue;
                }
            }

            let Some(expected) = file.size else {
                return Ok(());
            };
            match server
                .node
                .server_stat_file(server.node_server_id, target.clone())
                .await
            {
                Ok(entry) if entry.size == expected => return Ok(()),
                Ok(entry) => {
                    warn!(
                        "Attempt {attempt}: {} has {} bytes, expected {expected}",
                        file.path, entry.size
                    );
                    last = InstallFailure::from("size mismatch");
                }
                Err(err) => {
                    warn!("Attempt {attempt}: could not check {}: {err:?}", file.path);
                    last = InstallFailure::from("could not be verified");
                }
            }
        }

        Err(last)
    }

    async fn stage_entry(
        &self,
        server: &Server,
        file: &ModpackFile,
    ) -> (String, Result<(), InstallFailure>) {
        (file.path.clone(), self.stage_file(server, file).await)
    }

    async fn stage_files(
        &self,
        server: &Server,
        files: &[ModpackFile],
    ) -> Result<(), InstallFailure> {
        let server_id = server.id;
        let mut pending = files.iter();
        let mut running = FuturesUnordered::new();
        for file in pending.by_ref().take(PARALLEL_DOWNLOADS) {
            running.push(self.stage_entry(server, file));
        }

        let mut failures = Vec::new();
        while let Some((path, outcome)) = running.next().await {
            if let Some(file) = pending.next() {
                running.push(self.stage_entry(server, file));
            }

            let failed = match outcome {
                Ok(()) => None,
                Err(InstallFailure::Quota) => return Err(InstallFailure::Quota),
                Err(InstallFailure::Reason(reason)) => Some(format!("{path} ({reason})")),
            };
            if let Some(entry) = &failed {
                failures.push(entry.clone());
            }
            self.update_job(server_id, |job| {
                job.done = job.done.saturating_add(1);
                if let Some(entry) = failed {
                    job.failures.push(entry);
                }
            })
            .await;
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(InstallFailure::from(format!(
                "{} pack file(s) could not be downloaded, so nothing on the server was changed",
                failures.len()
            )))
        }
    }

    async fn pack_identities(
        &self,
        provider: ResourceProvider,
        files: &[ModpackFile],
        mut identities: HashMap<String, (String, String)>,
    ) -> Vec<ModpackFileRecord> {
        if provider == ResourceProvider::Modrinth {
            let hashes: Vec<String> = files.iter().filter_map(|file| file.sha1.clone()).collect();
            if !hashes.is_empty() {
                match self.resource_client().identify_modrinth(&hashes).await {
                    Ok(found) => {
                        for file in files {
                            if let Some(identity) =
                                file.sha1.as_ref().and_then(|hash| found.get(hash))
                            {
                                identities.insert(file.path.clone(), identity.clone());
                            }
                        }
                    }
                    Err(err) => warn!("Failed to identify pack files on Modrinth: {err:?}"),
                }
            }
        }

        let mut projects: Vec<String> = identities
            .values()
            .map(|(project, _version)| project.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        projects.sort_unstable();

        let details: HashMap<String, ProjectDetails> = if projects.is_empty() {
            HashMap::new()
        } else {
            match self.resource_client().projects(provider, &projects).await {
                Ok(details) => details
                    .into_iter()
                    .map(|detail| (detail.id.clone(), detail))
                    .collect(),
                Err(err) => {
                    warn!("Failed to load pack project details: {err:?}");
                    HashMap::new()
                }
            }
        };

        files
            .iter()
            .map(|file| {
                let identity = identities.get(&file.path);
                let detail = identity.and_then(|(project, _version)| details.get(project));
                ModpackFileRecord {
                    path: file.path.clone(),
                    project: identity.map(|(project, _version)| project.clone()),
                    version: identity.map(|(_project, version)| version.clone()),
                    title: detail.map(|detail| detail.title.chars().take(MAX_PACK_TITLE).collect()),
                    icon_url: detail.and_then(|detail| detail.icon_url.clone()),
                    page_url: detail.and_then(|detail| detail.page_url.clone()),
                }
            })
            .collect()
    }

    async fn server_running(&self, server: &Server) -> bool {
        server
            .node
            .server_status(server.node_server_id)
            .await
            .is_ok_and(|status| is_running_label(&status.state.label))
    }

    async fn prepare_pack(
        &self,
        server: &Server,
        pack_file: &str,
        pack_url: url::Url,
    ) -> Result<Modpack, InstallFailure> {
        let server_id = server.id;
        let archive = format!("{STAGING_DIR}/{pack_file}");
        let extracted = extracted_dir();

        if !self.remove_path(server, STAGING_DIR, true).await {
            return Err(InstallFailure::from(
                "A previous install's leftovers could not be cleared",
            ));
        }
        self.ensure_dir(server, STAGING_DIR).await?;

        self.set_step(server_id, ModpackStep::Downloading).await;
        server
            .node
            .server_write_file_by_url(server.node_server_id, archive.clone(), pack_url)
            .await
            .map_err(|err| {
                error!("Failed to download modpack archive: {err:?}");
                match err {
                    ServerWriteFileByUrlError::StorageQuotaReached => InstallFailure::Quota,
                    _ => InstallFailure::from("The pack archive could not be downloaded"),
                }
            })?;

        self.set_step(server_id, ModpackStep::Unpacking).await;
        server
            .node
            .server_unpack_archive(server.node_server_id, archive, extracted.clone())
            .await
            .map_err(|err| {
                error!("Failed to unpack modpack archive: {err:?}");
                match err {
                    ServerUnpackArchiveError::CompressionUnsupported => {
                        InstallFailure::from("The pack archive format is not supported")
                    }
                    ServerUnpackArchiveError::StorageQuotaReached => InstallFailure::Quota,
                    _ => InstallFailure::from("The pack archive could not be unpacked"),
                }
            })?;

        self.set_step(server_id, ModpackStep::Reading).await;
        let pack = self
            .read_pack_manifest(server, &extracted)
            .await
            .map_err(|err| {
                error!("Failed to read modpack manifest: {err:?}");
                InstallFailure::from("The pack contains no usable manifest")
            })?;

        if !pack.rejected.is_empty() {
            return Err(InstallFailure::from(format!(
                "The pack lists files with unsafe paths or untrusted download hosts: {}",
                report(&pack.rejected)
            )));
        }

        Ok(pack)
    }

    async fn remove_pack_file(&self, server: &Server, path: &str) -> bool {
        self.remove_path(server, path, false).await
            && self.remove_path(server, &disabled_name(path), false).await
    }

    async fn commit_pack(
        &self,
        server: &Server,
        files: &[ModpackFileRecord],
        provider: ResourceProvider,
        previous: Option<&ModpackRecord>,
        reset: bool,
    ) -> Vec<String> {
        let mut failures = Vec::new();
        let new_paths: HashSet<&str> = files.iter().map(|file| file.path.as_str()).collect();

        let mut listings: HashMap<String, Option<HashSet<String>>> = HashMap::new();
        let mut dirs: HashSet<String> = files
            .iter()
            .filter_map(|file| parent_dir(&file.path).map(str::to_owned))
            .collect();
        if let Some(previous) = previous {
            dirs.extend(
                previous
                    .files
                    .iter()
                    .filter_map(|file| parent_dir(&file.path).map(str::to_owned)),
            );
        }
        dirs.insert(
            ResourceType::Modification
                .path_prefix()
                .trim_end_matches('/')
                .to_owned(),
        );
        for dir in dirs {
            let names = self.list_names(server, &dir).await;
            listings.insert(dir, names);
        }
        let is_disabled = |path: &str| {
            let Some((dir, name)) = path.rsplit_once('/') else {
                return false;
            };
            listings
                .get(dir)
                .and_then(Option::as_ref)
                .is_some_and(|names| names.contains(&disabled_name(name)))
        };

        let disabled_projects: HashSet<&str> = previous
            .map(|previous| {
                previous
                    .files
                    .iter()
                    .filter(|file| is_disabled(&file.path))
                    .filter_map(|file| file.project.as_deref())
                    .collect()
            })
            .unwrap_or_default();

        if let Some(previous) = previous {
            for file in &previous.files {
                if !new_paths.contains(file.path.as_str())
                    && !self.remove_pack_file(server, &file.path).await
                {
                    failures.push(file.path.clone());
                }
            }
        }

        let pack_projects: HashSet<&str> = files
            .iter()
            .filter_map(|file| file.project.as_deref())
            .collect();
        match list_installed(&self.database, server.id).await {
            Ok(added) => {
                let mut superseded = Vec::new();
                for resource in added {
                    let path = format!(
                        "{}{}",
                        resource.resource_type.path_prefix(),
                        resource.file_name
                    );
                    if resource.provider != provider
                        || !pack_projects.contains(resource.project.as_str())
                        || new_paths.contains(path.as_str())
                    {
                        continue;
                    }
                    if self.remove_pack_file(server, &path).await {
                        superseded.push(resource.file_name);
                    } else {
                        failures.push(path);
                    }
                }
                if !superseded.is_empty()
                    && let Err(err) =
                        delete_installed_files(&self.database, server.id, &superseded).await
                {
                    warn!("Failed to forget mods the pack now ships: {err:?}");
                }
            }
            Err(err) => warn!("Failed to check added mods against the pack: {err:?}"),
        }

        if reset {
            let mods_dir = ResourceType::Modification
                .path_prefix()
                .trim_end_matches('/');
            let names: Vec<String> = listings
                .get(mods_dir)
                .and_then(Option::as_ref)
                .map(|names| names.iter().cloned().collect())
                .unwrap_or_default();
            let mut cleared = Vec::new();
            for name in names {
                if !super::resource::is_resource_file(ResourceType::Modification, &name) {
                    continue;
                }
                let base = super::resource::base_file_name(&name);
                if new_paths.contains(format!("{mods_dir}/{base}").as_str()) {
                    continue;
                }
                let path = format!("{mods_dir}/{name}");
                if self.remove_path(server, &path, false).await {
                    cleared.push(base);
                } else {
                    failures.push(path);
                }
            }
            if !cleared.is_empty()
                && let Err(err) = delete_installed_files(&self.database, server.id, &cleared).await
            {
                warn!("Failed to forget cleared mod records: {err:?}");
            }
        }

        for file in files {
            let disabled = !reset
                && (is_disabled(&file.path)
                    || file
                        .project
                        .as_deref()
                        .is_some_and(|project| disabled_projects.contains(project)));
            let destination = if disabled {
                disabled_name(&file.path)
            } else {
                file.path.clone()
            };

            if let Some(parent) = parent_dir(&file.path)
                && self.ensure_dir(server, parent).await.is_err()
            {
                failures.push(file.path.clone());
                continue;
            }
            if !self.remove_pack_file(server, &file.path).await {
                failures.push(file.path.clone());
                continue;
            }

            if let Err(err) = server
                .node
                .server_rename_file(
                    server.node_server_id,
                    staged_path(&file.path),
                    destination.clone(),
                )
                .await
            {
                warn!("Failed to move {} into place: {err:?}", file.path);
                failures.push(file.path.clone());
            }
        }

        failures
    }

    async fn run_modpack_install(
        &self,
        server: Server,
        payload: InstallModpackPayload,
        pack_file: String,
        pack_url: url::Url,
    ) {
        let server_id = server.id;
        let outcome = self
            .install_pack(&server, &payload, &pack_file, pack_url)
            .await;

        if !self.remove_path(&server, STAGING_DIR, true).await {
            warn!("Failed to clean up the modpack staging directory on {server_id}");
        }

        match outcome {
            Ok(()) => {
                self.update_job(server_id, |job| {
                    job.step = ModpackStep::Done;
                    job.state = if job.failures.is_empty() {
                        ModpackJobState::Completed
                    } else {
                        job.error = Some(
                            "The pack was installed, but some files could not be put in place"
                                .to_owned(),
                        );
                        ModpackJobState::Failed
                    };
                    job.finished_at = Some(chrono::Utc::now().timestamp());
                })
                .await;
            }
            Err(failure) => {
                let reason = failure.reason();
                error!("Modpack install failed on server {server_id}: {reason}");
                self.update_job(server_id, |job| {
                    job.state = ModpackJobState::Failed;
                    job.error = Some(reason);
                    job.finished_at = Some(chrono::Utc::now().timestamp());
                })
                .await;
            }
        }
    }

    async fn install_pack(
        &self,
        server: &Server,
        payload: &InstallModpackPayload,
        pack_file: &str,
        pack_url: url::Url,
    ) -> Result<(), InstallFailure> {
        let server_id = server.id;
        let pack = self.prepare_pack(server, pack_file, pack_url).await?;

        self.set_step(server_id, ModpackStep::Resolving).await;
        let plan = self
            .plan_platform(server, pack.platform.clone(), payload.sync_platform)
            .await?;
        let platform_changes = plan.new_extra.is_some();
        let pack_name = pack.name.clone();
        let target = plan.target.clone();
        self.update_job(server_id, |job| {
            if job.pack.is_none() {
                job.pack = pack_name;
            }
            job.platform = platform_changes.then_some(target);
        })
        .await;

        let mut identities = HashMap::new();
        let mut skipped = Vec::new();
        let files = self
            .resolve_curseforge_files(pack.files.clone(), &mut identities, &mut skipped)
            .await?;
        let total = u32::try_from(files.len()).unwrap_or(u32::MAX);
        self.update_job(server_id, |job| {
            job.step = ModpackStep::Fetching;
            job.total = total;
            job.skipped = skipped;
        })
        .await;

        self.stage_files(server, &files).await?;

        let records = self
            .pack_identities(payload.provider, &files, identities)
            .await;

        if self.server_running(server).await {
            return Err(InstallFailure::from(
                "The server was started during the install, so nothing on it was changed",
            ));
        }

        if payload.backup {
            self.set_step(server_id, ModpackStep::BackingUp).await;
            server
                .node
                .server_create_backup_order(server.node_server_id, None)
                .await
                .map_err(|err| {
                    error!("Modpack backup failed for {server_id}: {err:?}");
                    match err {
                        ServerCreateBackupOrderError::BackupStorageNoSuitableFound => {
                            InstallFailure::from("No backup storage is available on this node")
                        }
                        _ => InstallFailure::from("The backup could not be created"),
                    }
                })?;
        }

        if let Some(new_extra) = plan.new_extra {
            self.set_step(server_id, ModpackStep::Platform).await;
            self.push_template_extra(server, new_extra)
                .await
                .map_err(|err| {
                    error!("Failed to switch the platform for a pack on {server_id}: {err:?}");
                    match err {
                        BuildPushError::Template(_) | BuildPushError::Database(_) => {
                            InstallFailure::from("The server's platform could not be changed")
                        }
                        BuildPushError::Node => InstallFailure::from(
                            "The node did not accept the new platform, so nothing was changed",
                        ),
                    }
                })?;
        }

        self.update_job(server_id, |job| {
            job.step = ModpackStep::Applying;
            job.live_untouched = false;
        })
        .await;

        let previous = get_modpack(&self.database, server_id)
            .await
            .map_err(|err| {
                error!("Failed to load the previous modpack: {err:?}");
                InstallFailure::from("The previous pack could not be loaded")
            })?;

        let failures = self
            .commit_pack(
                server,
                &records,
                payload.provider,
                previous.as_ref(),
                payload.mode == ModpackInstallMode::Reset,
            )
            .await;

        self.set_step(server_id, ModpackStep::Configuring).await;
        let extracted = extracted_dir();
        let (mut copied, mut override_failures) = self
            .apply_overrides(server, &format!("{extracted}/{OVERRIDES_DIR}"))
            .await;
        let (server_copied, server_failures) = self
            .apply_overrides(server, &format!("{extracted}/{SERVER_OVERRIDES_DIR}"))
            .await;
        copied = copied.saturating_add(server_copied);
        override_failures.extend(server_failures);
        info!("Applied {copied} override file(s) for a pack on {server_id}");

        self.set_step(server_id, ModpackStep::Finishing).await;
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
            game_version: plan.target.game_version.clone(),
            loader_version: plan.target.loader_version.clone(),
            files: records,
            installed_at: chrono::Utc::now().timestamp(),
        };
        if let Err(err) = replace_modpack(&self.database, server_id, &record).await {
            error!("Failed to record the installed modpack: {err:?}");
            return Err(InstallFailure::from(
                "The pack was installed, but it could not be linked to the server",
            ));
        }

        self.update_job(server_id, |job| {
            job.failures.extend(failures);
            job.failures.extend(override_failures);
        })
        .await;

        Ok(())
    }
}

#[service(path = "/modpack/{server_id}", tag = "modpack", no_sdk)]
pub(crate) impl ModpackService for Backend {
    /// Progress of this server's modpack install, if one has run.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_READ`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
    async fn modpack_status(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Option<ModpackJob>, _> {
        auth.require::<_, _, ModpackStatusError>(server_id, ServerPermissions::FILES_READ)?;

        Ok(self.modpack_job(server_id).await?)
    }

    /// Installs, updates or reinstalls a modpack in the background.
    ///
    /// The install is staged: the pack and every file it lists are downloaded
    /// into `.novium-modpack/` and checked against the sizes the pack declares
    /// before anything on the server changes. If any download fails the job
    /// stops there and the server is left exactly as it was.
    ///
    /// Only then is the server switched over: files of the previously linked
    /// pack that the new version no longer ships are removed, the new files are
    /// moved into place and the pack's configuration overrides are applied.
    /// Mods added on top of the pack are kept, and pack mods that were disabled
    /// stay disabled. With `mode: reset` every mod that is not part of the pack is
    /// removed as well, which returns the server to the pack's original state.
    ///
    /// A pack declares the loader and Minecraft version it was built for. When
    /// the server runs something else, `sync_platform` switches the server's
    /// software to match (this also needs [`ServerPermissions::BUILD_EDIT`]);
    /// without it the install is refused instead of producing a server that
    /// cannot start. `backup` creates a backup right before the switch-over.
    ///
    /// Returns as soon as the job is accepted. Progress is polled from
    /// `GET /modpack/{id}`. The server has to stay stopped while it runs.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_WRITE`], and
    /// [`ServerPermissions::BUILD_EDIT`] when `sync_platform` is set.
    #[route("/install", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, resource::{invalid_payload, provider_unavailable, provider_disabled, provider_error, download_unavailable, missing, wrong_template}, modpack::{not_confirmed, already_running, server_running})]
    async fn install_modpack(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        payload: InstallModpackPayload,
    ) -> Result<ModpackJob, _> {
        auth.require::<_, _, InstallModpackError>(server_id, ServerPermissions::FILES_WRITE)?;
        if payload.sync_platform {
            auth.require::<_, _, InstallModpackError>(server_id, ServerPermissions::BUILD_EDIT)?;
        }

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

        if self.server_running(&server).await {
            return Err(InstallModpackError::ModpackServerRunning);
        }

        if self.modpack_installing(server_id).await {
            return Err(InstallModpackError::ModpackAlreadyRunning);
        }

        let resolved = self
            .resource_client()
            .resolve(payload.provider, &payload.project, &payload.version)
            .await
            .map_err(ResourceError::into::<InstallModpackError>)?;

        let lock = job_lock(server_id);
        if !self.try_lock(&lock, JOB_LOCK_TTL).await {
            return Err(InstallModpackError::ModpackAlreadyRunning);
        }

        let pack_file = sanitize_file_name(&resolved.file_name, "modpack.zip");
        let job = ModpackJob::new(payload.title.clone());
        self.set_job(server_id, job.clone()).await;

        let backend = self.clone();
        let url = resolved.url;
        self.jobs.lock().await.spawn(async move {
            let heartbeat = backend.hold_lock(lock.clone());
            backend
                .run_modpack_install(server, payload, pack_file, url)
                .await;
            drop(heartbeat);
            backend.modpack_jobs.write().await.remove(&server_id);
            backend.release_lock(&lock).await;
        });

        Ok(job)
    }

    /// Forgets the modpack this server is linked to.
    ///
    /// Only the link is dropped: the pack's mods and configuration stay on
    /// disk, so the server keeps running exactly as it did. Its jars stop being
    /// reported as pack contents and show up as hand-uploaded files instead,
    /// and the loader and Minecraft version can be changed freely again.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_WRITE`].
    #[route("", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, modpack::already_running)]
    async fn unlink_modpack(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        auth.require::<_, _, UnlinkModpackError>(server_id, ServerPermissions::FILES_WRITE)?;

        if self.modpack_installing(server_id).await {
            return Err(UnlinkModpackError::ModpackAlreadyRunning);
        }

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
