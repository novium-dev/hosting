use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;

use crate::service::file::file_service_error::ListFilesError;
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use daemon_common::service::files::FileEntry;
use daemon_common::service::files::files_service_error::ServerListFilesError;
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
}
