use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ServerPermissions};
use crate::db::server::ServerId;
use crate::service::backup::backup_service_error::{
    CreateBackupError, CreateBackupWithStorageError, DeleteBackupError, DownloadBackupError,
    ListBackupsError, RealtimeDownloadBackupError, RestoreBackupError, UpdateBackupError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use daemon_common::service::backup::BackupResponseEntry;
use daemon_common::service::backup::backup_service_error::{
    ServerCreateBackupError, ServerCreateBackupOrderError, ServerDeleteBackupError,
    ServerListBackupsError, ServerRestoreBackupError, ServerSetBackupNameError,
};
use serde::Deserialize;
use tracing::error;
use zelus::service;

#[service(path = "/backup/{server_id}", tag = "backup", no_sdk)]
pub(crate) impl BackupService for Backend {
    #[route("", method = GET, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::storage_unavailable)]
    async fn list_backups(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
        server_id: ServerId,
    ) -> Result<Paged<BackupResponseEntry>, _> {
        auth.require::<_, _, ListBackupsError>(server_id, ServerPermissions::BACKUP_VIEW)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ListBackupsError::ServerNotFound)?;

        Ok(server
            .node
            .server_list_backups(server.node_server_id)
            .await
            .map_err(|err| match err {
                ServerListBackupsError::Communication(_) => {
                    error!("Failed to request backup listing: {:?}", err);
                    ListBackupsError::NodeFailure
                }
                ServerListBackupsError::AuthInvalid
                | ServerListBackupsError::StorageNotFound
                | ServerListBackupsError::SqlFailure
                | ServerListBackupsError::StorageFailure => {
                    error!("Failed to list backups: {:?}", err);
                    ListBackupsError::NodeFailure
                }
                ServerListBackupsError::StorageMutexLocked => {
                    ListBackupsError::BackupStorageUnavailable
                }
            })?
            .into_iter()
            .apply_pagesplit(&mut page)
            .collect_paged(page))
    }

    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, no_suitable_storage_found, limit_exceeded})]
    async fn create_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<i64, _> {
        auth.require::<_, _, CreateBackupError>(server_id, ServerPermissions::BACKUP_CREATE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(CreateBackupError::ServerNotFound)?;

        if !auth.has((), ManagementPermissions::LIMITS_BYPASS)
            && let Some(limit) = server.backup_limit
        {
            let current = server
                .node
                .server_list_backups(server.node_server_id)
                .await
                .map_err(|err| match err {
                    ServerListBackupsError::Communication(_) => {
                        error!("Failed to request backup listing: {:?}", err);
                        CreateBackupError::NodeFailure
                    }
                    ServerListBackupsError::AuthInvalid
                    | ServerListBackupsError::StorageNotFound
                    | ServerListBackupsError::SqlFailure
                    | ServerListBackupsError::StorageFailure => {
                        error!("Failed to list backups: {:?}", err);
                        CreateBackupError::NodeFailure
                    }
                    ServerListBackupsError::StorageMutexLocked => {
                        CreateBackupError::BackupStorageUnavailable
                    }
                })?
                .len();

            if (current as u64) >= u64::from(limit) {
                return Err(CreateBackupError::BackupLimitExceeded);
            }
        }

        server
            .node
            .server_create_backup_order(server.node_server_id)
            .await
            .map_err(|err| match err {
                ServerCreateBackupOrderError::Communication(_) => {
                    error!("Failed to request backup creation (by order): {:?}", err);
                    CreateBackupError::NodeFailure
                }
                ServerCreateBackupOrderError::AuthInvalid
                | ServerCreateBackupOrderError::StorageNotFound
                | ServerCreateBackupOrderError::SqlFailure
                | ServerCreateBackupOrderError::StorageFailure => {
                    error!("Failed to create backup (by order): {:?}", err);
                    CreateBackupError::NodeFailure
                }
                ServerCreateBackupOrderError::StorageMutexLocked => {
                    CreateBackupError::BackupStorageUnavailable
                }
                ServerCreateBackupOrderError::BackupStorageNoSuitableFound => {
                    CreateBackupError::BackupNoSuitableStorageFound
                }
            })
    }

    #[route("/{backup_storage}", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, storage_not_found, storage_incompatible, limit_exceeded})]
    async fn create_backup_with_storage(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup_storage: String,
    ) -> Result<i64, _> {
        auth.require::<_, _, CreateBackupWithStorageError>(
            server_id,
            ServerPermissions::BACKUP_CREATE,
        )?;
        auth.require::<_, _, CreateBackupWithStorageError>(
            (),
            ManagementPermissions::BACKUP_STORAGE_SELECT,
        )?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(CreateBackupWithStorageError::ServerNotFound)?;

        if !auth.has((), ManagementPermissions::LIMITS_BYPASS)
            && let Some(limit) = server.backup_limit
        {
            let current = server
                .node
                .server_list_backups(server.node_server_id)
                .await
                .map_err(|err| match err {
                    ServerListBackupsError::Communication(_) => {
                        error!("Failed to request backup listing: {:?}", err);
                        CreateBackupWithStorageError::NodeFailure
                    }
                    ServerListBackupsError::AuthInvalid
                    | ServerListBackupsError::StorageNotFound
                    | ServerListBackupsError::SqlFailure
                    | ServerListBackupsError::StorageFailure => {
                        error!("Failed to list backups: {:?}", err);
                        CreateBackupWithStorageError::NodeFailure
                    }
                    ServerListBackupsError::StorageMutexLocked => {
                        CreateBackupWithStorageError::BackupStorageUnavailable
                    }
                })?
                .len();

            if (current as u64) >= u64::from(limit) {
                return Err(CreateBackupWithStorageError::BackupLimitExceeded);
            }
        }

        server
            .node
            .server_create_backup(server.node_server_id, backup_storage)
            .await
            .map_err(|err| match err {
                ServerCreateBackupError::Communication(_) => {
                    error!("Failed to request backup creation: {:?}", err);
                    CreateBackupWithStorageError::NodeFailure
                }
                ServerCreateBackupError::AuthInvalid
                | ServerCreateBackupError::StorageNotFound
                | ServerCreateBackupError::SqlFailure
                | ServerCreateBackupError::StorageFailure => {
                    error!("Failed to create backup: {:?}", err);
                    CreateBackupWithStorageError::NodeFailure
                }
                ServerCreateBackupError::StorageMutexLocked => {
                    CreateBackupWithStorageError::BackupStorageUnavailable
                }
                ServerCreateBackupError::BackupStorageIncompatible => {
                    CreateBackupWithStorageError::BackupStorageIncompatible
                }
                ServerCreateBackupError::BackupStorageLocationNotFound => {
                    CreateBackupWithStorageError::BackupStorageNotFound
                }
            })
    }

    #[route("/{backup_storage}/{backup_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, not_found, storage_not_found})]
    async fn delete_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup_storage: String,
        backup_id: i64,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteBackupError>(server_id, ServerPermissions::BACKUP_DELETE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(DeleteBackupError::ServerNotFound)?;

        server
            .node
            .server_delete_backup(server.node_server_id, backup_storage, backup_id)
            .await
            .map_err(|err| match err {
                ServerDeleteBackupError::Communication(_) => {
                    error!("Failed to request backup deletion: {:?}", err);
                    DeleteBackupError::NodeFailure
                }
                ServerDeleteBackupError::AuthInvalid
                | ServerDeleteBackupError::StorageNotFound
                | ServerDeleteBackupError::SqlFailure
                | ServerDeleteBackupError::StorageFailure => {
                    error!("Failed to delete backup: {:?}", err);
                    DeleteBackupError::NodeFailure
                }
                ServerDeleteBackupError::StorageMutexLocked => {
                    DeleteBackupError::BackupStorageUnavailable
                }
                ServerDeleteBackupError::BackupNotFound => DeleteBackupError::BackupNotFound,
                ServerDeleteBackupError::BackupStorageLocationNotFound => {
                    DeleteBackupError::BackupStorageNotFound
                }
            })
    }

    #[route("/{backup_storage}/{backup_id}/restore", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, not_found, storage_not_found, quota_exceeded})]
    async fn restore_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup_storage: String,
        backup_id: i64,
    ) -> Result<(), _> {
        auth.require::<_, _, RestoreBackupError>(server_id, ServerPermissions::BACKUP_RESTORE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(RestoreBackupError::ServerNotFound)?;

        server
            .node
            .server_restore_backup(server.node_server_id, backup_storage, backup_id)
            .await
            .map_err(|err| match err {
                ServerRestoreBackupError::Communication(_) => {
                    error!("Failed to request backup restore: {:?}", err);
                    RestoreBackupError::NodeFailure
                }
                ServerRestoreBackupError::AuthInvalid
                | ServerRestoreBackupError::StorageNotFound
                | ServerRestoreBackupError::SqlFailure
                | ServerRestoreBackupError::StorageFailure => {
                    error!("Failed to restore backup: {:?}", err);
                    RestoreBackupError::NodeFailure
                }
                ServerRestoreBackupError::StorageMutexLocked => {
                    RestoreBackupError::BackupStorageUnavailable
                }
                ServerRestoreBackupError::BackupNotFound => RestoreBackupError::BackupNotFound,
                ServerRestoreBackupError::BackupStorageLocationNotFound => {
                    RestoreBackupError::BackupStorageNotFound
                }
                ServerRestoreBackupError::StorageQuotaReached => {
                    RestoreBackupError::BackupQuotaExceeded
                }
            })
    }

    #[route("/{backup_storage}/{backup_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn download_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup_storage: String,
        backup_id: i64,
    ) -> Result<String, _> {
        auth.require::<_, _, DownloadBackupError>(server_id, ServerPermissions::BACKUP_DOWNLOAD)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(DownloadBackupError::ServerNotFound)?;

        Ok(server
            .node
            .server_download_backup_user_url_signed(
                server.node_server_id,
                backup_storage,
                backup_id,
            )
            .to_string())
    }

    #[route("/rt", method = GET, query = [ compression ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::{not_found}, backup::compression_not_allowed)]
    async fn realtime_download_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        compression: String,
    ) -> Result<String, _> {
        auth.require::<_, _, RealtimeDownloadBackupError>(
            server_id,
            ServerPermissions::FILES_READ,
        )?;

        let allowed = ["tar", "tar.gz", "tar.xz", "tar.zst", "zip"];
        if !allowed.contains(&compression.as_str()) {
            return Err(RealtimeDownloadBackupError::BackupCompressionNotAllowed);
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(RealtimeDownloadBackupError::ServerNotFound)?;

        Ok(server
            .node
            .server_download_realtime_user_url_signed(server.node_server_id, compression)
            .to_string())
    }

    #[route("/{backup_storage}/{backup_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, not_found, storage_not_found})]
    async fn update_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup_storage: String,
        backup_id: i64,
        name: Option<String>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateBackupError>(server_id, ServerPermissions::BACKUP_RESTORE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateBackupError::ServerNotFound)?;

        server
            .node
            .server_set_backup_name(
                server.node_server_id,
                backup_storage,
                backup_id,
                name,
            )
            .await
            .map_err(|err| match err {
                ServerSetBackupNameError::Communication(_) => {
                    error!("Failed to request backup update: {:?}", err);
                    UpdateBackupError::NodeFailure
                }
                ServerSetBackupNameError::AuthInvalid
                | ServerSetBackupNameError::SqlFailure
                | ServerSetBackupNameError::StorageFailure => {
                    error!("Failed to update backup: {:?}", err);
                    UpdateBackupError::NodeFailure
                }
                ServerSetBackupNameError::StorageNotFound => UpdateBackupError::ServerNotFound,
                ServerSetBackupNameError::StorageMutexLocked => {
                    UpdateBackupError::BackupStorageUnavailable
                }
                ServerSetBackupNameError::BackupNotFound => UpdateBackupError::BackupNotFound,
                ServerSetBackupNameError::BackupStorageLocationNotFound => {
                    UpdateBackupError::BackupStorageNotFound
                }
            })
    }
}
