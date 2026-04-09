use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;

use crate::service::file::file_service_error::{
    ArchiveFileError, CopyFileError, CreateDirectoryError, DeleteFileError, ListFilesError,
    RenameFileError, UnarchiveFileError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use daemon_common::service::files::FileEntry;
use daemon_common::service::files::files_service_error::{
    ServerCopyFileError, ServerCreateArchiveError, ServerCreateDirectoryError,
    ServerDeleteFileError, ServerListFilesError, ServerRenameFileError, ServerUnpackArchiveError,
};
use tracing::error;
use zelus::service;

#[service(path = "/file/{server_id}", tag = "file", no_sdk)]
pub(crate) impl FileService for Backend {
    #[route("", method = GET, raw, query = [ path ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, not_directory})]
    async fn list_files(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
        server_id: ServerId,
        path: String,
    ) -> Result<Paged<FileEntry>, _> {
        auth.require::<_, ListFilesError>(server_id, ServerPermissions::FILES_READ)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ListFilesError::ServerNotFound)?;

        Ok(server
            .node
            .server_list_files(server.node_server_id, path)
            .await
            .map_err(|err| match err {
                ServerListFilesError::Communication(_) => {
                    error!("Failed to request file listing: {:?}", err);
                    ListFilesError::NodeFailure
                }
                ServerListFilesError::AuthInvalid
                | ServerListFilesError::StorageNotFound
                | ServerListFilesError::StorageFailure
                | ServerListFilesError::SqlFailure => {
                    error!("Failed to list files: {:?}", err);
                    ListFilesError::NodeFailure
                }
                ServerListFilesError::StorageMutexLocked => ListFilesError::FileStorageUnavailable,
                ServerListFilesError::FileNotFound => ListFilesError::FileNotFound,
                ServerListFilesError::FileSandboxViolated => ListFilesError::FileSandboxViolated,
                ServerListFilesError::FileNotDirectory => ListFilesError::FileNotDirectory,
            })?
            .into_iter()
            .apply_pagesplit(&mut page)
            .collect_paged(page))
    }

    #[route("/rename", method = POST, query = [ from, to ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists})]
    async fn rename_file(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        from: String,
        to: String,
    ) -> Result<(), _> {
        auth.require::<_, RenameFileError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(RenameFileError::ServerNotFound)?;

        server
            .node
            .server_rename_file(server.node_server_id, from, to)
            .await
            .map_err(|err| match err {
                ServerRenameFileError::Communication(_) => {
                    error!("Failed to request file rename: {:?}", err);
                    RenameFileError::NodeFailure
                }
                ServerRenameFileError::AuthInvalid
                | ServerRenameFileError::StorageNotFound
                | ServerRenameFileError::StorageFailure
                | ServerRenameFileError::SqlFailure => {
                    error!("Failed to rename file: {:?}", err);
                    RenameFileError::NodeFailure
                }
                ServerRenameFileError::StorageMutexLocked => {
                    RenameFileError::FileStorageUnavailable
                }
                ServerRenameFileError::FileNotFound => RenameFileError::FileNotFound,
                ServerRenameFileError::FileSandboxViolated => RenameFileError::FileSandboxViolated,
                ServerRenameFileError::FileAlreadyExists => RenameFileError::FileAlreadyExists,
            })?;

        Ok(())
    }

    #[route("/copy", method = POST, query = [ from, to ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, is_directory, quota_exceeded})]
    async fn copy_file(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        from: String,
        to: String,
    ) -> Result<(), _> {
        auth.require::<_, CopyFileError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(CopyFileError::ServerNotFound)?;

        server
            .node
            .server_copy_file(server.node_server_id, from, to)
            .await
            .map_err(|err| match err {
                ServerCopyFileError::Communication(_) => {
                    error!("Failed to request file copy: {:?}", err);
                    CopyFileError::NodeFailure
                }
                ServerCopyFileError::AuthInvalid
                | ServerCopyFileError::StorageNotFound
                | ServerCopyFileError::StorageFailure
                | ServerCopyFileError::SqlFailure => {
                    error!("Failed to copy file: {:?}", err);
                    CopyFileError::NodeFailure
                }
                ServerCopyFileError::StorageMutexLocked => CopyFileError::FileStorageUnavailable,
                ServerCopyFileError::FileNotFound => CopyFileError::FileNotFound,
                ServerCopyFileError::FileSandboxViolated => CopyFileError::FileSandboxViolated,
                ServerCopyFileError::FileIsDirectory => CopyFileError::FileIsDirectory,
                ServerCopyFileError::StorageQuotaReached => CopyFileError::FileQuotaExceeded,
            })?;

        Ok(())
    }

    #[route("/delete", method = POST, query = [ path, recursive ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, not_directory, is_directory})]
    async fn delete_file(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        path: String,
        recursive: bool,
    ) -> Result<(), _> {
        auth.require::<_, DeleteFileError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(DeleteFileError::ServerNotFound)?;

        server
            .node
            .server_delete_file(server.node_server_id, path, recursive)
            .await
            .map_err(|err| match err {
                ServerDeleteFileError::Communication(_) => {
                    error!("Failed to request file delete: {:?}", err);
                    DeleteFileError::NodeFailure
                }
                ServerDeleteFileError::AuthInvalid
                | ServerDeleteFileError::StorageNotFound
                | ServerDeleteFileError::StorageFailure
                | ServerDeleteFileError::SqlFailure => {
                    error!("Failed to delete file: {:?}", err);
                    DeleteFileError::NodeFailure
                }
                ServerDeleteFileError::StorageMutexLocked => {
                    DeleteFileError::FileStorageUnavailable
                }
                ServerDeleteFileError::FileNotFound => DeleteFileError::FileNotFound,
                ServerDeleteFileError::FileSandboxViolated => DeleteFileError::FileSandboxViolated,
                ServerDeleteFileError::FileNotDirectory => DeleteFileError::FileNotDirectory,
                ServerDeleteFileError::FileIsDirectory => DeleteFileError::FileIsDirectory,
            })?;

        Ok(())
    }

    #[route("/mkdir", method = POST, query = [ path, recursive ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, quota_exceeded})]
    async fn create_directory(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        path: String,
        recursive: bool,
    ) -> Result<(), _> {
        auth.require::<_, CreateDirectoryError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(CreateDirectoryError::ServerNotFound)?;

        server
            .node
            .server_create_directory(server.node_server_id, path, recursive)
            .await
            .map_err(|err| match err {
                ServerCreateDirectoryError::Communication(_) => {
                    error!("Failed to request directory creation: {:?}", err);
                    CreateDirectoryError::NodeFailure
                }
                ServerCreateDirectoryError::AuthInvalid
                | ServerCreateDirectoryError::StorageNotFound
                | ServerCreateDirectoryError::StorageFailure
                | ServerCreateDirectoryError::SqlFailure => {
                    error!("Failed to create directory: {:?}", err);
                    CreateDirectoryError::NodeFailure
                }
                ServerCreateDirectoryError::StorageMutexLocked => {
                    CreateDirectoryError::FileStorageUnavailable
                }
                ServerCreateDirectoryError::FileNotFound => CreateDirectoryError::FileNotFound,
                ServerCreateDirectoryError::FileSandboxViolated => {
                    CreateDirectoryError::FileSandboxViolated
                }
                ServerCreateDirectoryError::FileAlreadyExists => {
                    CreateDirectoryError::FileAlreadyExists
                }
                ServerCreateDirectoryError::StorageQuotaReached => {
                    CreateDirectoryError::FileQuotaExceeded
                }
            })?;

        Ok(())
    }

    #[route("/archive", method = POST, query = [ from, to, compression ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, is_directory, quota_exceeded, compression_unsupported})]
    async fn archive_file(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        from: String,
        to: String,
        compression: String,
    ) -> Result<(), _> {
        auth.require::<_, ArchiveFileError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ArchiveFileError::ServerNotFound)?;

        server
            .node
            .server_create_archive(server.node_server_id, from, to, compression)
            .await
            .map_err(|err| match err {
                ServerCreateArchiveError::Communication(_) => {
                    error!("Failed to request archive creation: {:?}", err);
                    ArchiveFileError::NodeFailure
                }
                ServerCreateArchiveError::AuthInvalid
                | ServerCreateArchiveError::StorageNotFound
                | ServerCreateArchiveError::StorageFailure
                | ServerCreateArchiveError::SqlFailure => {
                    error!("Failed to create archive: {:?}", err);
                    ArchiveFileError::NodeFailure
                }
                ServerCreateArchiveError::StorageMutexLocked => {
                    ArchiveFileError::FileStorageUnavailable
                }
                ServerCreateArchiveError::StorageQuotaReached => {
                    ArchiveFileError::FileQuotaExceeded
                }
                ServerCreateArchiveError::FileNotFound => ArchiveFileError::FileNotFound,
                ServerCreateArchiveError::FileSandboxViolated => {
                    ArchiveFileError::FileSandboxViolated
                }
                ServerCreateArchiveError::FileIsDirectory => ArchiveFileError::FileIsDirectory,
                ServerCreateArchiveError::CompressionUnsupported => {
                    ArchiveFileError::FileCompressionUnsupported
                }
            })?;

        Ok(())
    }

    #[route("/unarchive", method = POST, query = [ from, to ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, quota_exceeded, compression_unsupported})]
    async fn unarchive_file(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        from: String,
        to: String,
    ) -> Result<(), _> {
        auth.require::<_, UnarchiveFileError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UnarchiveFileError::ServerNotFound)?;

        server
            .node
            .server_unpack_archive(server.node_server_id, from, to)
            .await
            .map_err(|err| match err {
                ServerUnpackArchiveError::Communication(_) => {
                    error!("Failed to request archive extraction: {:?}", err);
                    UnarchiveFileError::NodeFailure
                }
                ServerUnpackArchiveError::AuthInvalid
                | ServerUnpackArchiveError::StorageNotFound
                | ServerUnpackArchiveError::StorageFailure
                | ServerUnpackArchiveError::SqlFailure => {
                    error!("Failed to extract archive: {:?}", err);
                    UnarchiveFileError::NodeFailure
                }
                ServerUnpackArchiveError::StorageMutexLocked => {
                    UnarchiveFileError::FileStorageUnavailable
                }
                ServerUnpackArchiveError::StorageQuotaReached => {
                    UnarchiveFileError::FileQuotaExceeded
                }
                ServerUnpackArchiveError::FileNotFound => UnarchiveFileError::FileNotFound,
                ServerUnpackArchiveError::FileSandboxViolated => {
                    UnarchiveFileError::FileSandboxViolated
                }
                ServerUnpackArchiveError::CompressionUnsupported => {
                    UnarchiveFileError::FileCompressionUnsupported
                }
            })?;

        Ok(())
    }
}
