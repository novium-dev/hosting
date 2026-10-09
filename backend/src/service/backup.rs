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
    ServerListBackupsError, ServerRestoreBackupError, ServerUpdateBackupError,
};
use tracing::error;
use zelus::{define_query_variable, service};

define_query_variable!(name "The name to give the backup");
define_query_variable!(protected "Whether the backup is exempt from retention policies");

fn backup_name(name: Option<String>) -> Option<String> {
    name.map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

#[service(path = "/backup/{server_id}", tag = "backup", no_sdk)]
pub(crate) impl BackupService for Backend {
    /// Lists the server's backups.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BACKUP_VIEW`].
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

    /// Creates a backup on whichever suitable storage the node picks.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BACKUP_CREATE`].
    #[route("", method = PUT, query = [name])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, no_suitable_storage_found, limit_exceeded})]
    async fn create_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        name: Option<String>,
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
            .server_create_backup_order(server.node_server_id, backup_name(name))
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

    /// Creates a backup on the given storage.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BACKUP_CREATE`] and [`ManagementPermissions::BACKUP_STORAGE_SELECT`].
    #[route("/{backup_storage}", method = PUT, query = [name])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, storage_not_found, storage_incompatible, limit_exceeded})]
    async fn create_backup_with_storage(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup_storage: String,
        name: Option<String>,
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
            .server_create_backup(server.node_server_id, backup_storage, backup_name(name))
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

    /// Deletes a backup.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BACKUP_DELETE`].
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

    /// Restores the server from a backup.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BACKUP_RESTORE`].
    #[route("/{backup_storage}/{backup_id}/restore", method = POST)]
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

    /// Gets a signed URL to download a backup.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BACKUP_DOWNLOAD`].
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

    /// Gets a signed URL to download a live archive of the server's files, built on demand rather than from a stored backup.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_READ`].
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

    /// Updates a backup's metadata. Every parameter left out stays untouched;
    /// an empty name removes the backup's name again.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BACKUP_RESTORE`].
    #[route("/{backup_storage}/{backup_id}", method = PATCH, query = [name, protected])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, backup::{storage_unavailable, not_found, storage_not_found})]
    async fn update_backup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup_storage: String,
        backup_id: i64,
        name: Option<String>,
        protected: Option<bool>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateBackupError>(server_id, ServerPermissions::BACKUP_RESTORE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateBackupError::ServerNotFound)?;

        server
            .node
            .server_update_backup(
                server.node_server_id,
                backup_storage,
                backup_id,
                name.map(|name| name.trim().to_owned()),
                protected,
            )
            .await
            .map_err(|err| match err {
                ServerUpdateBackupError::Communication(_) => {
                    error!("Failed to request backup update: {:?}", err);
                    UpdateBackupError::NodeFailure
                }
                ServerUpdateBackupError::AuthInvalid
                | ServerUpdateBackupError::SqlFailure
                | ServerUpdateBackupError::StorageFailure => {
                    error!("Failed to update backup: {:?}", err);
                    UpdateBackupError::NodeFailure
                }
                ServerUpdateBackupError::StorageNotFound => UpdateBackupError::ServerNotFound,
                ServerUpdateBackupError::StorageMutexLocked => {
                    UpdateBackupError::BackupStorageUnavailable
                }
                ServerUpdateBackupError::BackupNotFound => UpdateBackupError::BackupNotFound,
                ServerUpdateBackupError::BackupStorageLocationNotFound => {
                    UpdateBackupError::BackupStorageNotFound
                }
            })
    }
}
