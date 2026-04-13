use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;

use crate::resources::Resource;
use crate::service::file::file_service_error::{
    ArchiveFileError, CopyFileError, CreateDirectoryError, DeleteFileError, DownloadUserError,
    GetConfigError, GetResourceError, ListFilesError, RenameFileError, SetConfigError,
    StatFileError, SymlinkFileError, UnarchiveFileError, UploadUserError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use daemon_common::service::DataStream;
use daemon_common::service::files::FileEntry;
use daemon_common::service::files::files_service_error::{
    ServerCopyFileError, ServerCreateArchiveError, ServerCreateDirectoryError,
    ServerDeleteFileError, ServerDownloadFileError, ServerListFilesError, ServerRenameFileError,
    ServerStatFileError, ServerSymlinkError, ServerUnpackArchiveError,
    ServerWriteFileByTemplateError, ServerWriteFileByUrlError,
};
use daemon_common::service::server::ServerFileWrite;
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use tokio_util::io::SyncIoBridge;
use tracing::error;
use url::Url;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
struct UrlResponse {
    url: Url,
}

#[service(path = "/file/{server_id}", tag = "file", no_sdk)]
pub(crate) impl FileService for Backend {
    #[route("", method = GET, raw, query = [ path ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, not_directory})]
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

    #[route("/stat", method = GET, query = [ path ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated})]
    async fn stat_file(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        path: String,
    ) -> Result<FileEntry, _> {
        auth.require::<_, StatFileError>(server_id, ServerPermissions::FILES_READ)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(StatFileError::ServerNotFound)?;

        server
            .node
            .server_stat_file(server.node_server_id, path)
            .await
            .map_err(|err| match err {
                ServerStatFileError::Communication(_) => {
                    error!("Failed to request file stat: {:?}", err);
                    StatFileError::NodeFailure
                }
                ServerStatFileError::AuthInvalid
                | ServerStatFileError::StorageNotFound
                | ServerStatFileError::StorageFailure
                | ServerStatFileError::SqlFailure => {
                    error!("Failed to stat file: {:?}", err);
                    StatFileError::NodeFailure
                }
                ServerStatFileError::StorageMutexLocked => StatFileError::FileStorageUnavailable,
                ServerStatFileError::FileNotFound => StatFileError::FileNotFound,
                ServerStatFileError::FileSandboxViolated => StatFileError::FileSandboxViolated,
            })
    }

    #[route("/rename", method = POST, query = [ from, to ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists})]
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, is_directory, quota_exceeded})]
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, not_directory, is_directory})]
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, quota_exceeded})]
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

    #[route("/symlink", method = POST, query = [ path, content ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, quota_exceeded})]
    async fn symlink_file(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        path: String,
        content: String,
    ) -> Result<(), _> {
        auth.require::<_, SymlinkFileError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(SymlinkFileError::ServerNotFound)?;

        server
            .node
            .server_symlink(server.node_server_id, path, content)
            .await
            .map_err(|err| match err {
                ServerSymlinkError::Communication(_) => {
                    error!("Failed to request symlink: {:?}", err);
                    SymlinkFileError::NodeFailure
                }
                ServerSymlinkError::AuthInvalid
                | ServerSymlinkError::StorageNotFound
                | ServerSymlinkError::StorageFailure
                | ServerSymlinkError::SqlFailure => {
                    error!("Failed to symlink: {:?}", err);
                    SymlinkFileError::NodeFailure
                }
                ServerSymlinkError::StorageMutexLocked => SymlinkFileError::FileStorageUnavailable,
                ServerSymlinkError::StorageQuotaReached => SymlinkFileError::FileQuotaExceeded,
                ServerSymlinkError::FileNotFound => SymlinkFileError::FileNotFound,
                ServerSymlinkError::FileSandboxViolated => SymlinkFileError::FileSandboxViolated,
                ServerSymlinkError::FileAlreadyExists => SymlinkFileError::FileAlreadyExists,
            })
    }

    #[route("/download", method = GET, query = [ path, limit ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn download_user(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        path: String,
        limit: Option<u64>,
    ) -> Result<UrlResponse, _> {
        auth.require::<_, DownloadUserError>(server_id, ServerPermissions::FILES_READ)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(DownloadUserError::ServerNotFound)?;

        Ok(UrlResponse {
            url: server.node.server_download_file_user_url_signed(
                server.node_server_id,
                path,
                limit,
            ),
        })
    }

    #[route("/upload", method = GET, query = [ path ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn upload_user(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        path: String,
    ) -> Result<UrlResponse, _> {
        auth.require::<_, UploadUserError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UploadUserError::ServerNotFound)?;

        Ok(UrlResponse {
            url: server
                .node
                .server_upload_file_user_url_signed(server.node_server_id, path),
        })
    }

    #[route("/archive", method = POST, query = [ from, to, compression ])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, is_directory, quota_exceeded, compression_unsupported})]
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, file::{storage_unavailable, not_found, sandbox_violated, already_exists, quota_exceeded, compression_unsupported})]
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

    #[route("/config/{file_name}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::{not_found, config_invalid}, node::failure, file::{storage_unavailable, not_found, sandbox_violated, is_directory, unsupported_type})]
    async fn get_config(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        file_name: String,
    ) -> Result<Value, _> {
        auth.require::<_, GetConfigError>(server_id, ServerPermissions::FILES_READ)?;

        let ext = file_name
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_lowercase();
        if !["properties", "json", "yaml", "yml"].contains(&ext.as_str()) {
            return Err(GetConfigError::FileUnsupportedType);
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(GetConfigError::ServerNotFound)?;

        let (data, empty) = match server
            .node
            .server_download_file(server.node_server_id, file_name.clone(), Some(0x0002_0000))
            .await
        {
            Ok(response) => (response.1, false),
            Err(ServerDownloadFileError::FileNotFound) => {
                (DataStream::Stream(Box::pin(futures::stream::empty())), true)
            }
            Err(ServerDownloadFileError::FileLimitReached) => {
                return Err(GetConfigError::ServerConfigInvalid);
            }
            Err(err) => {
                return Err(match err {
                    ServerDownloadFileError::Communication(_) => {
                        error!("Failed to request file download: {:?}", err);
                        GetConfigError::NodeFailure
                    }
                    ServerDownloadFileError::AuthInvalid
                    | ServerDownloadFileError::StorageNotFound
                    | ServerDownloadFileError::StorageFailure
                    | ServerDownloadFileError::SqlFailure => {
                        error!("Failed to download file: {:?}", err);
                        GetConfigError::NodeFailure
                    }
                    ServerDownloadFileError::StorageMutexLocked => {
                        GetConfigError::FileStorageUnavailable
                    }
                    ServerDownloadFileError::FileSandboxViolated => {
                        GetConfigError::FileSandboxViolated
                    }
                    ServerDownloadFileError::FileIsDirectory => GetConfigError::FileIsDirectory,
                    ServerDownloadFileError::FileNotFound
                    | ServerDownloadFileError::FileLimitReached => {
                        GetConfigError::ServerConfigInvalid
                    }
                });
            }
        };

        match ext.as_str() {
            "properties" => {
                let parsed = tokio::task::spawn_blocking(move || {
                    java_properties::read(SyncIoBridge::new(data.reader())).map_err(|err| {
                        error!("Failed to read properties file {}: {:?}", file_name, err);
                        GetConfigError::ServerConfigInvalid
                    })
                })
                .await
                .map_err(|err| {
                    error!("Properties parsing task failed: {:?}", err);
                    GetConfigError::ServerConfigInvalid
                })??;

                serde_json::to_value(parsed).map_err(|err| {
                    error!("Failed to serialize properties map: {:?}", err);
                    GetConfigError::ServerConfigInvalid
                })
            }
            "json" => {
                if empty {
                    Ok(Value::Object(serde_json::Map::default()))
                } else {
                    tokio::task::spawn_blocking(move || {
                        serde_json::from_reader::<_, Value>(SyncIoBridge::new(data.reader()))
                            .map_err(|err| {
                                error!("Failed to parse JSON config {}: {:?}", file_name, err);
                                GetConfigError::ServerConfigInvalid
                            })
                    })
                    .await
                    .map_err(|err| {
                        error!("JSON parsing task failed: {:?}", err);
                        GetConfigError::ServerConfigInvalid
                    })?
                }
            }
            "yaml" | "yml" => {
                let yaml_value: serde_yaml_ng::Value = tokio::task::spawn_blocking(move || {
                    serde_yaml_ng::from_reader::<_, serde_yaml_ng::Value>(SyncIoBridge::new(
                        data.reader(),
                    ))
                    .map_err(|err| {
                        error!("Failed to parse YAML config {}: {:?}", file_name, err);
                        GetConfigError::ServerConfigInvalid
                    })
                })
                .await
                .map_err(|err| {
                    error!("YAML parsing task failed: {:?}", err);
                    GetConfigError::ServerConfigInvalid
                })??;

                serde_json::to_value(yaml_value).map_err(|err| {
                    error!("Failed to serialize YAML value: {:?}", err);
                    GetConfigError::ServerConfigInvalid
                })
            }
            _ => Err(GetConfigError::FileUnsupportedType),
        }
    }

    #[route("/config/{file_name}", method = POST, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::{not_found, config_invalid}, node::failure, file::{storage_unavailable, not_found, sandbox_violated, is_directory, quota_exceeded, unsupported_type, content_invalid})]
    async fn set_config(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        file_name: String,
        payload: Value,
    ) -> Result<(), _> {
        auth.require::<_, SetConfigError>(server_id, ServerPermissions::FILES_WRITE)?;

        let ext = file_name
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_lowercase();
        if !["properties", "json", "yaml", "yml"].contains(&ext.as_str()) {
            return Err(SetConfigError::FileUnsupportedType);
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(SetConfigError::ServerNotFound)?;

        let write = match ext.as_str() {
            "properties" => {
                let object = payload
                    .as_object()
                    .ok_or(SetConfigError::FileContentInvalid)?;
                let mut content = HashMap::with_capacity(object.len());
                for (key, value) in object {
                    let Some(value) = value.as_str() else {
                        return Err(SetConfigError::FileContentInvalid);
                    };
                    content.insert(key.clone(), value.to_owned());
                }
                ServerFileWrite::JavaProperties { content }
            }
            "json" => ServerFileWrite::Json {
                set: serde_json::from_value(payload).map_err(|err| {
                    error!("Invalid JSON payload for config set: {:?}", err);
                    SetConfigError::FileContentInvalid
                })?,
            },
            "yaml" | "yml" => ServerFileWrite::Yaml {
                set: serde_json::from_value(payload).map_err(|err| {
                    error!("Invalid YAML payload for config set: {:?}", err);
                    SetConfigError::FileContentInvalid
                })?,
            },
            _ => return Err(SetConfigError::FileUnsupportedType),
        };

        server
            .node
            .server_write_file_by_template(server.node_server_id, file_name, write)
            .await
            .map_err(|err| match err {
                ServerWriteFileByTemplateError::Communication(_) => {
                    error!("Failed to request file upload (by template): {:?}", err);
                    SetConfigError::NodeFailure
                }
                ServerWriteFileByTemplateError::AuthInvalid
                | ServerWriteFileByTemplateError::StorageNotFound
                | ServerWriteFileByTemplateError::StorageFailure
                | ServerWriteFileByTemplateError::SqlFailure => {
                    error!("Failed to upload file (by template): {:?}", err);
                    SetConfigError::NodeFailure
                }
                ServerWriteFileByTemplateError::StorageMutexLocked => {
                    SetConfigError::FileStorageUnavailable
                }
                ServerWriteFileByTemplateError::StorageQuotaReached => {
                    SetConfigError::FileQuotaExceeded
                }
                ServerWriteFileByTemplateError::FileNotFound => SetConfigError::FileNotFound,
                ServerWriteFileByTemplateError::FileSandboxViolated => {
                    SetConfigError::FileSandboxViolated
                }
                ServerWriteFileByTemplateError::FileIsDirectory => SetConfigError::FileIsDirectory,
                ServerWriteFileByTemplateError::StoragePatchFailed => {
                    SetConfigError::ServerConfigInvalid
                }
            })
    }

    #[route("/resource", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure, resource::{invalid_payload,provider_unavailable, resource_missing, provider_error, wrong_template}, file::{storage_unavailable, not_found, sandbox_violated, is_directory, quota_exceeded, already_exists})]
    async fn get_resource(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        resource: Resource,
    ) -> Result<(), _> {
        auth.require::<_, GetResourceError>(server_id, ServerPermissions::FILES_WRITE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(GetResourceError::ServerNotFound)?;

        let (url, filename) = resource
            .resolve_to_url::<GetResourceError>(server.template.id(), &Client::new())
            .await?;

        server
            .node
            .server_create_directory(
                server.node_server_id,
                resource.r#type().path_prefix().to_owned(),
                true,
            )
            .await
            .map_err(|err| match err {
                ServerCreateDirectoryError::Communication(_) => {
                    error!(
                        "Failed to request directory creation for resource: {:?}",
                        err
                    );
                    GetResourceError::NodeFailure
                }
                ServerCreateDirectoryError::AuthInvalid
                | ServerCreateDirectoryError::StorageNotFound
                | ServerCreateDirectoryError::StorageFailure
                | ServerCreateDirectoryError::SqlFailure => {
                    error!("Failed to create directory for resource: {:?}", err);
                    GetResourceError::NodeFailure
                }
                ServerCreateDirectoryError::StorageMutexLocked => {
                    GetResourceError::FileStorageUnavailable
                }
                ServerCreateDirectoryError::FileNotFound => GetResourceError::FileNotFound,
                ServerCreateDirectoryError::FileSandboxViolated => {
                    GetResourceError::FileSandboxViolated
                }
                ServerCreateDirectoryError::FileAlreadyExists => {
                    GetResourceError::FileAlreadyExists
                }
                ServerCreateDirectoryError::StorageQuotaReached => {
                    GetResourceError::FileQuotaExceeded
                }
            })?;

        server
            .node
            .server_write_file_by_url(
                server.node_server_id,
                format!("{}{}", resource.r#type().path_prefix(), filename),
                url,
            )
            .await
            .map_err(|err| match err {
                ServerWriteFileByUrlError::Communication(_) => {
                    error!(
                        "Failed to request file upload (by URL) for resource: {:?}",
                        err
                    );
                    GetResourceError::NodeFailure
                }
                ServerWriteFileByUrlError::AuthInvalid
                | ServerWriteFileByUrlError::StorageNotFound
                | ServerWriteFileByUrlError::StorageFailure
                | ServerWriteFileByUrlError::SqlFailure => {
                    error!("Failed to upload file (by URL) for resource: {:?}", err);
                    GetResourceError::NodeFailure
                }
                ServerWriteFileByUrlError::StorageMutexLocked => {
                    GetResourceError::FileStorageUnavailable
                }
                ServerWriteFileByUrlError::StorageQuotaReached => {
                    GetResourceError::FileQuotaExceeded
                }
                ServerWriteFileByUrlError::FileNotFound => GetResourceError::FileNotFound,
                ServerWriteFileByUrlError::FileSandboxViolated => {
                    GetResourceError::FileSandboxViolated
                }
                ServerWriteFileByUrlError::FileIsDirectory => GetResourceError::FileIsDirectory,
                ServerWriteFileByUrlError::HttpRequestFailed
                | ServerWriteFileByUrlError::HttpRequestReadFailed
                | ServerWriteFileByUrlError::HttpRequestNotSuccess => {
                    GetResourceError::ResourceProviderUnavailable
                }
            })?;

        Ok(())
    }
}
