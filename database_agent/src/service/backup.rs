use crate::backup;
use crate::instance::Instance;
use crate::state::Agent;
use crate::store::data;
use chrono::Utc;
use database_agent_common::service::backup::BackupService;
use database_agent_common::service::backup::backup_service_error::{
    CreateDatabaseBackupError, DeleteDatabaseBackupError, DownloadDatabaseBackupError,
    ListDatabaseBackupsError, RestoreDatabaseBackupError, UpdateDatabaseBackupError,
};
use database_agent_common::service::backup::error_backup_failure::FromBackupFailure;
use database_agent_common::service::error_database_not_found::FromDatabaseNotFound;
use database_agent_common::service::error_instance_not_found::FromInstanceNotFound;
use database_agent_common::service::error_instance_unsupported::FromInstanceUnsupported;
use database_agent_common::service::error_store_failure::FromStoreFailure;
use database_agent_common::service::{DataStream, FileResponse};
use database_agent_common::types::{
    BackupOperation, ContainerState, DatabaseBackups, StoredBackup, StoredDatabase,
};
use std::path::PathBuf;
use uuid::Uuid;
use zelus::async_trait;

trait OrBackupFailure<T> {
    fn or_backup_failure<E: FromBackupFailure>(self, context: &str) -> Result<T, E>;
}

impl<T> OrBackupFailure<T> for anyhow::Result<T> {
    fn or_backup_failure<E: FromBackupFailure>(self, context: &str) -> Result<T, E> {
        self.map_err(|err| {
            tracing::error!("{context}: {err:?}");
            E::from()
        })
    }
}

struct Target {
    instance: Instance,
    database: StoredDatabase,
    directory: PathBuf,
}

impl Agent {
    async fn backup_target<E>(&self, instance_id: Uuid, database_id: Uuid) -> Result<Target, E>
    where
        E: FromInstanceNotFound + FromInstanceUnsupported + FromDatabaseNotFound + FromStoreFailure,
    {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or_else(<E as FromInstanceNotFound>::from)?;

        if !instance.database_type().await.has_named_databases() {
            return Err(<E as FromInstanceUnsupported>::from());
        }

        let database = data::database(self.store.read(), instance_id, database_id)
            .await
            .map_err(|err| {
                tracing::error!("failed to read a database: {err:?}");
                <E as FromStoreFailure>::from()
            })?
            .ok_or_else(<E as FromDatabaseNotFound>::from)?;

        Ok(Target {
            instance,
            directory: self.database_backup_dir(instance_id, database_id),
            database,
        })
    }
}

#[async_trait]
impl BackupService for Agent {
    async fn list_database_backups(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<DatabaseBackups, ListDatabaseBackupsError> {
        let target = self
            .backup_target::<ListDatabaseBackupsError>(instance_id, database_id)
            .await?;

        Ok(DatabaseBackups {
            backups: backup::list_backups(&target.directory)
                .await
                .or_backup_failure::<ListDatabaseBackupsError>("failed to list backups")?,
            running: self.backup_operation(database_id),
        })
    }

    async fn create_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        name: Option<String>,
    ) -> Result<i64, CreateDatabaseBackupError> {
        let target = self
            .backup_target::<CreateDatabaseBackupError>(instance_id, database_id)
            .await?;

        if target.instance.container_state().await != ContainerState::Running {
            return Err(CreateDatabaseBackupError::InstanceOffline);
        }

        let guard = self
            .begin_backup_operation(database_id, BackupOperation::Backup)
            .ok_or(CreateDatabaseBackupError::BackupBusy)?;

        let mut time = Utc::now().timestamp_millis();
        while backup::get_backup(&target.directory, time)
            .await
            .or_backup_failure::<CreateDatabaseBackupError>("failed to read a backup")?
            .is_some()
        {
            time = time.saturating_add(1);
        }

        let name = name
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty());

        tokio::spawn(async move {
            if let Err(err) = backup::create_backup(
                &target.instance,
                &target.database,
                &target.directory,
                time,
                name,
            )
            .await
            {
                tracing::error!(
                    instance = %target.instance.uuid,
                    database = %target.database.uuid,
                    "failed to create a backup: {err:?}"
                );
            }
            drop(guard);
        });

        Ok(time)
    }

    async fn download_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<FileResponse, DownloadDatabaseBackupError> {
        let target = self
            .backup_target::<DownloadDatabaseBackupError>(instance_id, database_id)
            .await?;

        let file = backup::open_backup(&target.directory, backup_id)
            .await
            .or_backup_failure::<DownloadDatabaseBackupError>("failed to open a backup")?
            .ok_or(DownloadDatabaseBackupError::BackupNotFound)?;

        Ok(FileResponse::Header {
            stream: DataStream::by_read(file, None),
            disposition: None,
            r#type: None,
        })
    }

    async fn update_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
        name: Option<String>,
        protected: Option<bool>,
    ) -> Result<StoredBackup, UpdateDatabaseBackupError> {
        let target = self
            .backup_target::<UpdateDatabaseBackupError>(instance_id, database_id)
            .await?;

        backup::update_backup(&target.directory, backup_id, name, protected)
            .await
            .or_backup_failure::<UpdateDatabaseBackupError>("failed to update a backup")?
            .ok_or(UpdateDatabaseBackupError::BackupNotFound)
    }

    async fn delete_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<(), DeleteDatabaseBackupError> {
        let target = self
            .backup_target::<DeleteDatabaseBackupError>(instance_id, database_id)
            .await?;

        backup::delete_backup(&target.directory, backup_id)
            .await
            .or_backup_failure::<DeleteDatabaseBackupError>("failed to delete a backup")?
            .then_some(())
            .ok_or(DeleteDatabaseBackupError::BackupNotFound)
    }

    async fn restore_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<(), RestoreDatabaseBackupError> {
        let target = self
            .backup_target::<RestoreDatabaseBackupError>(instance_id, database_id)
            .await?;

        if target.instance.container_state().await != ContainerState::Running {
            return Err(RestoreDatabaseBackupError::InstanceOffline);
        }

        let guard = self
            .begin_backup_operation(database_id, BackupOperation::Restore)
            .ok_or(RestoreDatabaseBackupError::BackupBusy)?;

        let file = backup::open_backup(&target.directory, backup_id)
            .await
            .or_backup_failure::<RestoreDatabaseBackupError>("failed to open a backup")?
            .ok_or(RestoreDatabaseBackupError::BackupNotFound)?;

        tokio::spawn(async move {
            if let Err(err) = backup::restore_backup(&target.instance, &target.database, file).await
            {
                tracing::error!(
                    instance = %target.instance.uuid,
                    database = %target.database.uuid,
                    "failed to restore backup {backup_id}: {err:?}"
                );
            }
            drop(guard);
        });

        Ok(())
    }
}
