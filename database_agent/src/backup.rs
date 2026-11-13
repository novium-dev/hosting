use crate::instance::Instance;
use crate::state::Agent;
use anyhow::Context as _;
use async_compression::tokio::bufread::{ZstdDecoder, ZstdEncoder};
use core::cmp::Reverse;
use database_agent_common::types::{BackupOperation, StoredBackup, StoredDatabase};
use serde::{Deserialize, Serialize};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tokio::fs::File;
use tokio::io::{AsyncWriteExt as _, BufReader};
use uuid::Uuid;

const ARCHIVE_EXTENSION: &str = "zst";
const METADATA_EXTENSION: &str = "json";
const PARTIAL_EXTENSION: &str = "part";

#[derive(Debug, Default, Serialize, Deserialize)]
struct BackupMetadata {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    protected: bool,
}

pub struct BackupGuard {
    agent: Agent,
    database: Uuid,
}

impl Drop for BackupGuard {
    fn drop(&mut self) {
        self.agent.backup_operations.lock().remove(&self.database);
    }
}

impl Agent {
    pub fn backup_operation(&self, database: Uuid) -> Option<BackupOperation> {
        self.backup_operations.lock().get(&database).copied()
    }

    pub fn begin_backup_operation(
        &self,
        database: Uuid,
        operation: BackupOperation,
    ) -> Option<BackupGuard> {
        let mut operations = self.backup_operations.lock();
        if operations.contains_key(&database) {
            return None;
        }
        operations.insert(database, operation);
        drop(operations);

        Some(BackupGuard {
            agent: self.clone(),
            database,
        })
    }

    pub fn database_backup_dir(&self, instance: Uuid, database: Uuid) -> PathBuf {
        self.config.backup_dir(instance).join(database.to_string())
    }

    pub async fn remove_database_backups(&self, instance: Uuid, database: Uuid) {
        let directory = self.database_backup_dir(instance, database);
        if let Err(err) = tokio::fs::remove_dir_all(&directory).await
            && err.kind() != ErrorKind::NotFound
        {
            tracing::warn!(%instance, %database, "failed to remove {}: {err}", directory.display());
        }
    }
}

fn archive_path(directory: &Path, time: i64) -> PathBuf {
    directory.join(format!("{time}.{ARCHIVE_EXTENSION}"))
}

fn metadata_path(directory: &Path, time: i64) -> PathBuf {
    directory.join(format!("{time}.{METADATA_EXTENSION}"))
}

fn partial_path(directory: &Path, time: i64) -> PathBuf {
    directory.join(format!("{time}.{ARCHIVE_EXTENSION}.{PARTIAL_EXTENSION}"))
}

async fn read_metadata(directory: &Path, time: i64) -> anyhow::Result<BackupMetadata> {
    match tokio::fs::read(metadata_path(directory, time)).await {
        Ok(raw) => Ok(serde_json::from_slice(&raw).unwrap_or_else(|err| {
            tracing::warn!("discarding unreadable backup metadata of {time}: {err}");
            BackupMetadata::default()
        })),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(BackupMetadata::default()),
        Err(err) => Err(err).context("failed to read backup metadata"),
    }
}

async fn write_metadata(
    directory: &Path,
    time: i64,
    metadata: &BackupMetadata,
) -> anyhow::Result<()> {
    let target = metadata_path(directory, time);
    let staging = directory.join(format!("{time}.{METADATA_EXTENSION}.{PARTIAL_EXTENSION}"));
    tokio::fs::write(&staging, serde_json::to_vec(metadata)?)
        .await
        .context("failed to write backup metadata")?;
    tokio::fs::rename(&staging, &target)
        .await
        .context("failed to move backup metadata into place")
}

pub async fn get_backup(directory: &Path, time: i64) -> anyhow::Result<Option<StoredBackup>> {
    let size = match tokio::fs::metadata(archive_path(directory, time)).await {
        Ok(metadata) => metadata.len(),
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err).context("failed to stat a backup"),
    };
    let metadata = read_metadata(directory, time).await?;

    Ok(Some(StoredBackup {
        time,
        name: metadata.name,
        size,
        protected: metadata.protected,
    }))
}

pub async fn list_backups(directory: &Path) -> anyhow::Result<Vec<StoredBackup>> {
    let mut entries = match tokio::fs::read_dir(directory).await {
        Ok(entries) => entries,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err).context("failed to read the backup directory"),
    };

    let mut backups = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let file_name = entry.file_name();
        let Some(time) = file_name
            .to_str()
            .and_then(|name| name.strip_suffix(&format!(".{ARCHIVE_EXTENSION}")))
            .and_then(|time| time.parse::<i64>().ok())
        else {
            continue;
        };

        if let Some(backup) = get_backup(directory, time).await? {
            backups.push(backup);
        }
    }

    backups.sort_unstable_by_key(|backup| Reverse(backup.time));
    Ok(backups)
}

async fn remove_partials(directory: &Path) -> anyhow::Result<()> {
    let mut entries = match tokio::fs::read_dir(directory).await {
        Ok(entries) => entries,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err).context("failed to read the backup directory"),
    };

    while let Some(entry) = entries.next_entry().await? {
        let is_partial = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.ends_with(&format!(".{PARTIAL_EXTENSION}")));
        if is_partial {
            tokio::fs::remove_file(entry.path()).await?;
        }
    }

    Ok(())
}

pub async fn create_backup(
    instance: &Instance,
    database: &StoredDatabase,
    directory: &Path,
    time: i64,
    name: Option<String>,
) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(directory)
        .await
        .context("failed to create the backup directory")?;
    remove_partials(directory).await?;

    let partial = partial_path(directory, time);
    let result = async {
        let dump = instance.export(Some(&database.name)).await?;
        let mut encoder = ZstdEncoder::new(BufReader::new(dump));
        let mut file = File::create(&partial)
            .await
            .context("failed to create the backup file")?;
        tokio::io::copy(&mut encoder, &mut file)
            .await
            .context("failed to write the backup")?;
        file.flush().await?;
        file.sync_all().await?;
        drop(file);

        let mut probe = ZstdDecoder::new(BufReader::new(File::open(&partial).await?));
        let mut first = [0u8; 1];
        if tokio::io::AsyncReadExt::read(&mut probe, &mut first).await? == 0 {
            anyhow::bail!("the dump of {} was empty", database.name);
        }

        write_metadata(
            directory,
            time,
            &BackupMetadata {
                name,
                protected: false,
            },
        )
        .await?;
        tokio::fs::rename(&partial, archive_path(directory, time))
            .await
            .context("failed to move the backup into place")
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial).await;
        let _ = tokio::fs::remove_file(metadata_path(directory, time)).await;
    }

    result
}

pub async fn update_backup(
    directory: &Path,
    time: i64,
    name: Option<String>,
    protected: Option<bool>,
) -> anyhow::Result<Option<StoredBackup>> {
    if get_backup(directory, time).await?.is_none() {
        return Ok(None);
    }

    let mut metadata = read_metadata(directory, time).await?;
    if let Some(name) = name {
        let name = name.trim().to_owned();
        metadata.name = Some(name).filter(|name| !name.is_empty());
    }
    if let Some(protected) = protected {
        metadata.protected = protected;
    }
    write_metadata(directory, time, &metadata).await?;

    get_backup(directory, time).await
}

pub async fn delete_backup(directory: &Path, time: i64) -> anyhow::Result<bool> {
    match tokio::fs::remove_file(archive_path(directory, time)).await {
        Ok(()) => {}
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err).context("failed to delete a backup"),
    }

    match tokio::fs::remove_file(metadata_path(directory, time)).await {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(true),
        Err(err) => Err(err).context("failed to delete backup metadata"),
    }
}

pub async fn open_backup(directory: &Path, time: i64) -> anyhow::Result<Option<File>> {
    match File::open(archive_path(directory, time)).await {
        Ok(file) => Ok(Some(file)),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).context("failed to open a backup"),
    }
}

pub async fn restore_backup(
    instance: &Instance,
    database: &StoredDatabase,
    file: File,
) -> anyhow::Result<()> {
    let mut decoder = ZstdDecoder::new(BufReader::new(file));
    instance
        .import(Some(&database.name), true, &mut decoder)
        .await
}
