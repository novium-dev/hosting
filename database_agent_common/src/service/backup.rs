use super::*;
use crate::types::{DatabaseBackups, StoredBackup};
use uuid::Uuid;
use zelus::service;

define_error!(backup {
    not_found("The backup does not exist" NOT_FOUND),
    busy("Another backup operation is running for this database" CONFLICT),
    failure("The backup operation failed" INTERNAL_SERVER_ERROR),
});

define_path_variable!(backup_id "The backup's creation time in milliseconds, used as its id");

define_query_variable!(name "The name to give the backup");
define_query_variable!(protected "Whether the backup is exempt from retention policies");

#[service(
    path = "/instance/{instance_id}/database/{database_id}/backup",
    tag = "backup"
)]
pub trait BackupService {
    /// Lists the backups of a database, newest first, and the operation running on it.
    #[route("", method = GET)]
    #[error(instance::{not_found, unsupported}, database::not_found, backup::failure, store::failure)]
    async fn list_database_backups(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<DatabaseBackups, _>;

    /// Starts dumping a database into a new compressed backup and returns its id.
    ///
    /// The dump runs in the background; the backup is listed once it completed.
    #[route("", method = PUT, query = [ name ])]
    #[error(instance::{not_found, offline, unsupported}, database::not_found, backup::{busy, failure}, store::failure)]
    async fn create_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        name: Option<String>,
    ) -> Result<i64, _>;

    /// Streams a backup as a compressed (zstd) dump.
    #[route("/{backup_id}", method = GET, raw)]
    #[error(instance::{not_found, unsupported}, database::not_found, backup::{not_found, failure}, store::failure)]
    async fn download_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<FileResponse, _>;

    /// Updates a backup's metadata. A `null` field is left untouched and an
    /// empty `name` removes the name.
    #[route("/{backup_id}", method = PATCH, query = [ name, protected ])]
    #[error(instance::{not_found, unsupported}, database::not_found, backup::{not_found, failure}, store::failure)]
    async fn update_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
        name: Option<String>,
        protected: Option<bool>,
    ) -> Result<StoredBackup, _>;

    /// Deletes a backup.
    #[route("/{backup_id}", method = DELETE)]
    #[error(instance::{not_found, unsupported}, database::not_found, backup::{not_found, failure}, store::failure)]
    async fn delete_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<(), _>;

    /// Starts wiping a database and restoring a backup into it. The restore runs
    /// in the background.
    #[route("/{backup_id}/restore", method = POST)]
    #[error(instance::{not_found, offline, unsupported}, database::not_found, backup::{not_found, busy, failure}, store::failure)]
    async fn restore_database_backup(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<(), _>;
}
